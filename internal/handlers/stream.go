package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"

	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/kliuchnikovv/genie-api/internal/streamer"
)

// TODO: refactor this

type StreamInput struct {
	chatID  uuid.UUID
	q       url.Values // TODO: backward comp - remove
	user    *storage.User
	message string
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

	clientConn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		h.sendHTTPError(c, http.StatusServiceUnavailable, err)
		return
	}
	defer clientConn.Close()

	var query = *h.llmURL

	// Provide connector to (re)establish model connection with initial meta.
	connectModel := func() (*websocket.Conn, error) {
		hdr := http.Header{}
		hdr.Add("Cookie", "session_id=123") //TODO:

		values := query.Query()

		// Forward model parameter from client request to upstream LLM
		if modelParam := c.Query("model"); modelParam != "" {
			values.Add("model", modelParam)
			h.logger.Debug("forwarding model parameter to LLM", zap.String("model", modelParam))
		}

		// values.Add("chat_id", input.chatID.String())
		query.RawQuery = values.Encode()

		conn, _, err := websocket.DefaultDialer.Dial(query.String(), hdr)
		if err != nil {
			log.Printf("ws: upstream dial failed: %v, path is %s", err, query.String())
			return nil, err
		}
		// if err := h.sendWSMessage(conn, streamer.Frame{
		// 	ID:        0,
		// 	Kind:      streamer.TokenKind,
		// 	Operation: streamer.MessageOperation,
		// 	Payload: streamer.Payload{
		// 		Message: input.message,
		// 	},
		// 	Timestamp: time.Now().UTC(),
		// }); err != nil {
		// 	_ = conn.Close()
		// 	return nil, err
		// }
		return conn, nil
	}

	h.sendWSMessage(clientConn, streamer.Frame{
		Kind: streamer.MetaKind,
		// ChatID:    input.chatID,
		Operation: streamer.MessageOperation,
		Timestamp: time.Now().UTC(),
	})

	streamer.New(
		h.storage,
		h.logger,
		user.ID,
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
		user: user,
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
