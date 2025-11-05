package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

type StreamHandler struct {
	llmBase string
	client  *http.Client
	storage *storage.Storage
}

func NewStreamHandler(llmBaseURL string, store *storage.Storage) *StreamHandler {
	return &StreamHandler{llmBase: llmBaseURL, client: &http.Client{Timeout: 0}, storage: store}
}

// ChatStream removed (migrated to WebSocket-only streaming)

// ChatWS upgrades to WebSocket and forwards upstream SSE events as JSON messages.
// Each WS message is a JSON object: { id, event, data }
func (h *StreamHandler) ChatWS(c *gin.Context) {
	if h.llmBase == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "LLM base URL not configured"})
		return
	}

	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	clientConn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("ws: upgrade failed: %v", err)
		return
	}
	defer clientConn.Close()

	// Build upstream WS URL: ws(s)://<base>/llm/ws
	base, err := url.Parse(h.llmBase)
	if err != nil {
		_ = clientConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "bad upstream base URL"))
		return
	}
	switch base.Scheme {
	case "http":
		base.Scheme = "ws"
	case "https":
		base.Scheme = "wss"
	}
	base.Path, _ = url.JoinPath(base.Path, "/llm/ws")
	qv := c.Request.URL.Query()
	if strings.TrimSpace(qv.Get("q")) == "" {
		_ = clientConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "missing q"))
		return
	}
	base.RawQuery = qv.Encode()

	upstreamConn, _, err := websocket.DefaultDialer.Dial(base.String(), nil)
	if err != nil {
		log.Printf("ws: upstream dial failed: %v, path is %s", err, base.String())
		_ = clientConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseTryAgainLater, "upstream unavailable"))
		return
	}
	defer upstreamConn.Close()

	// Prepare persistence context for no-init: ensure chatId (create if absent) and save user message from q
	chatIdStr := c.Query("chatId")
	user, _ := userFromCtx(c.Request.Context())
	if user == nil {
		_ = clientConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "unauthorized"))
		return
	}
	var chatID uuid.UUID
	if chatIdStr != "" {
		cid, err := uuid.Parse(chatIdStr)
		if err != nil {
			_ = clientConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "bad chatId"))
			return
		}
		if _, err := h.storage.GetChat(c.Request.Context(), user.ID, cid); err != nil {
			_ = clientConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "invalid chatId"))
			return
		}
		chatID = cid
	} else {
		title := qv.Get("q")
		created, err := h.storage.CreateChat(c.Request.Context(), user.ID, &chat.Chat{ID: uuid.New(), Model: uuid.New(), Title: title, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()})
		if err != nil {
			_ = clientConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "chat create failed"))
			return
		}
		chatID = created.ID
		meta := map[string]any{"event": "meta", "data": map[string]any{"type": "chat", "chat_id": chatID.String()}}
		if b, err := json.Marshal(meta); err == nil {
			_ = clientConn.WriteMessage(websocket.TextMessage, b)
		}
	}
	// Persist user message from q
	if _, err := h.storage.CreateMessage(c.Request.Context(), user.ID, &chat.Message{ChatID: chatID, Role: chat.RoleUser, Text: qv.Get("q")}); err != nil {
		log.Printf("ws: failed to persist user message chatId=%s err=%v", chatID, err)
	}

	// Proxy upstream->client and accumulate tokens
	done := make(chan struct{})
	var accum strings.Builder
	var assistantMsgID uuid.UUID

	go func() {
		defer close(done)
		for {
			mt, data, err := upstreamConn.ReadMessage()
			if err != nil {
				if !websocket.IsCloseError(err) && !strings.Contains(err.Error(), "close") {
					log.Printf("ws: upstream read error chatId=%s err=%v", chatID, err)
				}
				return
			}
			if err := clientConn.WriteMessage(mt, data); err != nil {
				log.Printf("ws: write to client failed chatId=%s err=%v", chatID, err)
				return
			}

			if mt == websocket.TextMessage {
				var m struct {
					Event string          `json:"event"`
					Data  json.RawMessage `json:"data"`
				}
				if json.Unmarshal(data, &m) != nil {
					continue
				}
				if m.Event == "token" {
					var d struct {
						Delta string `json:"delta"`
					}
					if json.Unmarshal(m.Data, &d) == nil {
						accum.WriteString(d.Delta)
						if l := accum.Len(); l%500 == 0 {
							log.Printf("ws: token accumulation chatId=%s size=%d", chatID, l)
						}
						if chatID != uuid.Nil && user != nil {
							if assistantMsgID == uuid.Nil {
								if saved, err := h.storage.CreateMessage(c.Request.Context(), user.ID, &chat.Message{ChatID: chatID, Role: chat.RoleAssistant, Text: accum.String()}); err == nil {
									assistantMsgID = saved.ID
									log.Printf("ws: assistant draft created id=%s chatId=%s", assistantMsgID, chatID)
								} else {
									log.Printf("ws: assistant draft create failed chatId=%s err=%v", chatID, err)
								}
							} else {
								if err := h.storage.UpdateMessageText(c.Request.Context(), user.ID, assistantMsgID, accum.String()); err != nil {
									log.Printf("ws: assistant draft update failed id=%s err=%v", assistantMsgID, err)
								}
							}
						}
					}
					continue
				}
				if m.Event == "done" {
					// already persisted incrementally
				}
			}
		}
	}()

	// Optionally read from client to keep connection alive; ignore content
	for {
		if _, _, err := clientConn.ReadMessage(); err != nil {
			if !websocket.IsCloseError(err) {
				log.Printf("ws: client read loop ended chatId=%s err=%v", chatID, err)
			} else {
				log.Printf("ws: client closed chatId=%s", chatID)
			}
			break
		}
	}
	<-done
	log.Printf("ws: upstream stream finished chatId=%s", chatID)
}
