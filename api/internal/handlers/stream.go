package handlers

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"

	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/kliuchnikovv/genie-api/internal/streamer"
)

// TODO: refactor this

type StreamInput struct {
	chatID  uuid.UUID
	q       url.Values // TODO: backward comp - remove
	user    *storage.User
	message string
	source  string
}

type StreamHandler struct {
	llmURL   *url.URL
	client   *http.Client
	storage  *storage.Storage
	logger   *zap.Logger
	upgrader websocket.Upgrader
}

func NewStreamHandler(
	logger *zap.Logger,
	llmBaseURL string,
	store *storage.Storage,
) *StreamHandler {
	var (
		llmURL *url.URL
		err    error
	)

	if len(llmBaseURL) != 0 {
		llmURL, err = buildPathForWS(llmBaseURL)
	} else {
		logger.Warn("LLM base URL not configured - WebSockets not available - empty url")
	}

	if err != nil {
		logger.Warn("LLM base URL not configured - WebSockets not available", zap.Error(err))
	}

	return &StreamHandler{
		llmURL:  llmURL,
		storage: store,
		logger:  logger.With(zap.String("handler", "stream")),
		client: &http.Client{
			Timeout: 0,
		},
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // TODO: replace with whitelist
			},
		},
	}
}

// ChatWS upgrades to WebSocket and forwards upstream SSE events as JSON messages.
// Each WS message is a JSON object: { id, event, data }
func (h *StreamHandler) ChatWS(c *gin.Context) {
	// input, code, err := h.validate(c)
	// if code != 0 {
	// 	h.sendHTTPError(c, code, err)
	// 	return
	// }

	var ctx = c.Request.Context()
	user, _ := userFromCtx(ctx)
	if user == nil {
		h.sendHTTPError(c,
			http.StatusBadRequest, fmt.Errorf("can't find user info in context"),
		)
		return
	}

	h.logger.Info("client connected to websocket", zap.String("user_id", user.ID.String()))

	clientConn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		h.logger.Error("failed to upgrade websocket", zap.Error(err))
		h.sendHTTPError(c, http.StatusServiceUnavailable, err)
		return
	}
	defer func() {
		h.logger.Info("client websocket closed", zap.String("user_id", user.ID.String()))
		clientConn.Close()
	}()

	commandParam := c.Query("command")
	if commandParam == "" {
		commandParam = c.Query("team")
	}
	if commandParam == "" {
		commandParam = c.Query("team_desc")
	}
	modeParam := c.Query("mode")
	var commandPayload interface{}
	if commandParam != "" {
		var parsed interface{}
		if err := json.Unmarshal([]byte(commandParam), &parsed); err == nil {
			commandPayload = parsed
		} else {
			commandPayload = commandParam
		}
	}

	// Use chat_id as session_id for Agno memory
	var chatHistory []*chat.Message
	var historyChatID *uuid.UUID
	var sessionID string
	chatIDStr := c.Query("chat_id")
	if chatIDStr == "" {
		chatIDStr = c.Query("chatId") // alternate casing from frontend
	}
	if chatIDStr != "" {
		if chatID, err := uuid.Parse(chatIDStr); err == nil {
			historyChatID = &chatID
			sessionID = chatID.String()
		} else {
			h.logger.Warn("invalid chat_id format", zap.String("chat_id", chatIDStr))
		}
	}
	// CRITICAL: Never fall back to user.ID to prevent cross-chat memory leakage
	// If no chat_id, generate a new UUID for this session
	if sessionID == "" {
		newSessionID := uuid.New()
		sessionID = newSessionID.String()
		h.logger.Info("no chat_id provided, generated new session_id", zap.String("session_id", sessionID))
	}
	if modeParam == "team" {
		sessionID = fmt.Sprintf("%s-team", sessionID)
		h.logger.Debug("using team-scoped session_id", zap.String("session_id", sessionID))
	}

	// Load chat history from database if chat_id is provided
	if historyChatID != nil {
		messages, err := h.storage.GetMessages(ctx, user.ID, *historyChatID, 50) // Load last 50 messages
		if err != nil {
			h.logger.Warn("failed to load chat history", zap.Error(err), zap.String("chat_id", historyChatID.String()))
		} else {
			chatHistory = messages
			h.logger.Info("loaded chat history", zap.Int("count", len(chatHistory)), zap.String("chat_id", historyChatID.String()))
		}
	}

	// Provide connector to (re)establish model connection with initial meta.
	connectModel := func() (*websocket.Conn, error) {
		// Create a fresh URL for each connection attempt to avoid parameter accumulation
		query := url.URL{
			Scheme: h.llmURL.Scheme,
			Host:   h.llmURL.Host,
			Path:   h.llmURL.Path,
		}

		hdr := http.Header{}
		// Use chat_id as session_id so Agno's memory is keyed by chat.
		sessionCookie := fmt.Sprintf("session_id=%s", sessionID)
		hdr.Add("Cookie", sessionCookie)

		values := query.Query()

		// Forward model parameter from client request to upstream LLM
		if modelParam := c.Query("model"); modelParam != "" {
			values.Add("model", modelParam)
			h.logger.Info("forwarding model parameter to LLM", zap.String("model", modelParam))
		} else {
			h.logger.Info("no model parameter provided by client")
		}

		// Forward agent parameter from client request to upstream LLM
		if agentParam := c.Query("agent"); agentParam != "" {
			values.Add("agent", agentParam)
			h.logger.Info("forwarding agent parameter to LLM", zap.String("agent", agentParam))
		}

		// Forward team/command parameters to support team mode
		if modeParam != "" {
			values.Add("mode", modeParam)
			h.logger.Info("forwarding mode parameter to LLM", zap.String("mode", modeParam))
		}
		if commandParam != "" {
			values.Add("command", commandParam)
			h.logger.Info("forwarding command parameter to LLM")
		}

		// values.Add("chat_id", input.chatID.String())
		if sessionID != "" {
			values.Add("chat_id", sessionID)
		}
		query.RawQuery = values.Encode()

		h.logger.Info("dialing LLM service", zap.String("url", query.String()))
		conn, _, err := websocket.DefaultDialer.Dial(query.String(), hdr)
		if err != nil {
			h.logger.Error("ws: upstream dial failed", zap.Error(err), zap.String("url", query.String()))
			log.Printf("ws: upstream dial failed: %v, path is %s", err, query.String())
			return nil, err
		}
		h.logger.Info("connected to LLM service")
		return conn, nil
	}

	h.sendWSMessage(clientConn, streamer.Frame{
		Kind: streamer.MetaKind,
		// ChatID:    input.chatID,
		Operation: streamer.MessageOperation,
		Timestamp: time.Now().UTC(),
	})

	// Extract initial message from query params
	initialMessage := c.Query("message")
	if initialMessage == "" {
		initialMessage = c.Query("q") // backward compatibility
	}

	if initialMessage != "" {
		h.logger.Info("extracted initial message from query", zap.String("message", initialMessage))
	}

	// Extract attachments
	var initialAttachments []chat.Attachment
	if attachmentIDsStr := c.Query("attachment_ids"); attachmentIDsStr != "" {
		parts := strings.Split(attachmentIDsStr, ",")
		var ids []uuid.UUID
		for _, p := range parts {
			if id, err := uuid.Parse(strings.TrimSpace(p)); err == nil {
				ids = append(ids, id)
			}
		}

		if len(ids) > 0 {
			atts, err := h.storage.GetAttachmentsByIDs(ctx, ids)
			if err != nil {
				h.logger.Error("failed to fetch attachments", zap.Error(err))
			} else {
				for _, att := range atts {
					initialAttachments = append(initialAttachments, chat.Attachment{
						ID:       att.ID,
						FileName: att.FileName,
						FileType: att.FileType,
						Size:     att.Size,
						// Encode content to base64
						Content: base64.StdEncoding.EncodeToString(att.Content),
					})
				}
			}
		}
	}

	streamer.New(
		h.storage,
		h.logger,
		user.ID,
		initialMessage,
		initialAttachments,
		c.Query("source"),
		commandPayload,
		chatHistory,
		historyChatID,
		// input.chatID,
		connectModel,
	).Stream(streamer.NewSocketReader(
		clientConn,
		h.logger.With(zap.String("handler", "socker-reader")),
	))

	// Proxy upstream->client and accumulate tokens
	// done := make(chan struct{})
	// var accum strings.Builder
	// var assistantMsgID uuid.UUID

	// go func() {
	// 	defer close(done)
	// 	for {
	// 		mt, data, err := llmConn.ReadMessage()
	// 		if err != nil {
	// 			if !websocket.IsCloseError(err) && !strings.Contains(err.Error(), "close") {
	// 				log.Printf("ws: upstream read error chatId=%s err=%v", input.chatID, err)
	// 			}
	// 			return
	// 		}
	// 		if err := clientConn.WriteMessage(mt, data); err != nil {
	// 			log.Printf("ws: write to client failed chatId=%s err=%v", input.chatID, err)
	// 			return
	// 		}

	// 		if mt != websocket.TextMessage {
	// 			continue
	// 		}

	// 		var m struct {
	// 			Event string          `json:"event"`
	// 			Data  json.RawMessage `json:"data"`
	// 		}
	// 		if json.Unmarshal(data, &m) != nil {
	// 			continue
	// 		}

	// 		if m.Event == "done" {
	// 			// already persisted incrementally
	// 			continue
	// 		}

	// 		if m.Event != "token" {
	// 			continue
	// 		}
	// 		var d struct {
	// 			Delta string `json:"delta"`
	// 		}
	// 		if json.Unmarshal(m.Data, &d) != nil {
	// 			continue
	// 		}

	// 		accum.WriteString(d.Delta)
	// 		if l := accum.Len(); l%500 == 0 {
	// 			log.Printf("ws: token accumulation chatId=%s size=%d", input.chatID, l)
	// 		}

	// 		if assistantMsgID == uuid.Nil {
	// 			if saved, err := h.storage.CreateMessage(c.Request.Context(), input.user.ID, &chat.Message{ChatID: input.chatID, Role: chat.RoleAssistant, Text: accum.String()}); err == nil {
	// 				assistantMsgID = saved.ID
	// 				log.Printf("ws: assistant draft created id=%s chatId=%s", assistantMsgID, input.chatID)
	// 			} else {
	// 				log.Printf("ws: assistant draft create failed chatId=%s err=%v", input.chatID, err)
	// 			}
	// 		} else {
	// 			if err := h.storage.UpdateMessageText(c.Request.Context(), input.user.ID, assistantMsgID, accum.String()); err != nil {
	// 				log.Printf("ws: assistant draft update failed id=%s err=%v", assistantMsgID, err)
	// 			}
	// 		}
	// 	}
	// }()

	// // Optionally read from client to keep connection alive; ignore content
	// for {
	// 	if _, _, err := clientConn.ReadMessage(); err != nil {
	// 		if !websocket.IsCloseError(err) {
	// 			log.Printf("ws: client read loop ended chatId=%s err=%v", input.chatID, err)
	// 		} else {
	// 			log.Printf("ws: client closed chatId=%s", input.chatID)
	// 		}
	// 		break
	// 	}
	// }
	// <-done
	// log.Printf("ws: upstream stream finished chatId=%s", input.chatID)
}

func (h *StreamHandler) validate(c *gin.Context) (*StreamInput, int, error) {
	if h.llmURL == nil {
		return nil, http.StatusServiceUnavailable, fmt.Errorf("LLM base URL not configured")
	}

	// qv := c.Request.URL.Query()
	// if strings.TrimSpace(qv.Get("q")) == "" {
	// 	return nil, http.StatusBadRequest, fmt.Errorf("missing query parameter 'q'")
	// }

	// chatIDStr := c.Query("chatId")
	// if chatIDStr == "" {
	// 	return nil, http.StatusBadRequest, fmt.Errorf("missing query parameter 'chatId'")
	// }

	// messageIDStr := c.Query("messageId")
	// if messageIDStr == "" {
	// 	return nil, http.StatusBadRequest, fmt.Errorf("missing query parameter 'messageId'")
	// }

	var ctx = c.Request.Context()
	user, _ := userFromCtx(ctx)
	if user == nil {
		return nil, http.StatusBadRequest, fmt.Errorf("can't find user info in context")
	}

	// chatID, err := uuid.Parse(chatIDStr)
	// if err != nil {
	// 	return nil, http.StatusBadRequest, fmt.Errorf("bad chatId: %w", err)
	// }

	// messageID, err := uuid.Parse(messageIDStr)
	// if err != nil {
	// 	return nil, http.StatusBadRequest, fmt.Errorf("bad messageId: %w", err)
	// }

	// if _, err := h.storage.GetChat(ctx, user.ID, chatID); err != nil {
	// 	return nil, http.StatusBadRequest, fmt.Errorf("chat not found: %w", err)
	// }

	// message, err := h.storage.GetMessage(ctx, user.ID, messageID)
	// if err != nil {
	// 	return nil, http.StatusInternalServerError, fmt.Errorf("message creation failed: %w", err)
	// }

	return &StreamInput{
		// chatID:  chatID,
		// q:       qv,
		user:   user,
		source: c.Query("source"),
		// message: message.Text,
	}, 0, nil
}

func (h *StreamHandler) sendHTTPError(
	c *gin.Context,
	code int,
	err error,
) {
	h.logger.Error("got error", zap.Error(err))
	c.JSON(code, gin.H{
		"error": err.Error(),
	})
}

func (h *StreamHandler) sendWSMessage(
	conn *websocket.Conn,
	frame streamer.Frame,
) error {
	b, err := json.Marshal(frame)
	if err != nil {
		return err
	}

	return conn.WriteMessage(websocket.TextMessage, b)
}

// type Event string

// const (
// 	Token Event = "token"
// 	Done  Event = "done"
// 	Meta  Event = "meta"
// // )

// type wsMessage struct {
// 	Event Event  `json:"event"`
// 	Data  wsData `json:"data"`
// }

// type wsData struct {
// 	Delta            string `json:"delta,omitempty"`
// 	Index            uint   `json:"index,omitempty"`
// 	FinishReason     string `json:"finish_reason,omitempty"`
// 	Type             string `json:"type,omitempty"`
// 	ChatID           string `json:"chat_id,omitempty"`
// 	PromptTokens     uint   `json:"prompt_tokens,omitempty"`
// 	CompletionTokens uint   `json:"completion_tokens,omitempty"`
// }

func buildPathForWS(baseUrl string) (*url.URL, error) {
	// Build upstream WS URL: ws(s)://<result>/llm/ws
	result, err := url.Parse(baseUrl)
	if err != nil {
		return nil, fmt.Errorf("bad upstream base URL: %w", err)
	}

	switch result.Scheme {
	case "http":
		result.Scheme = "ws"
	case "https":
		result.Scheme = "wss"
	default:
		return nil, fmt.Errorf("unsupported scheme: %s", result.Scheme)
	}

	if result.Path, err = url.JoinPath(result.Path, "/llm/ws"); err != nil {
		return nil, fmt.Errorf("can't join path: %w", err)
	}

	return result, nil
}
