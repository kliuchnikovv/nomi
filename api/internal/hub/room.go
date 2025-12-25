package hub

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type Room struct {
	ID     uuid.UUID
	hub    *Hub
	logger *zap.Logger
	store  *storage.Storage

	// The user who initiated the session (for context/integrations)
	initiatorID uuid.UUID

	clients    map[*Client]bool
	ingress    chan *ClientMessage
	register   chan *Client
	unregister chan *Client

	// LLM Connection
	llmBaseURL string
	llmSocket  *Socket
	llmFrames  <-chan Frame
	llmErrs    <-chan error
	// Context for LLM reading
	llmCtx    context.Context
	llmCancel context.CancelFunc

	// Metadata tracking for current assistant message
	currentMessageMetadata struct {
		MessageID uuid.UUID
		Model     string
		ToolCalls interface{}
		Text      string
		Reasoning string
	}
}

func NewRoom(hub *Hub, id uuid.UUID, initiatorID uuid.UUID, store *storage.Storage, logger *zap.Logger, llmBaseURL string) *Room {
	return &Room{
		ID:          id,
		hub:         hub,
		logger:      logger.With(zap.String("room_id", id.String())),
		store:       store,
		initiatorID: initiatorID,
		clients:     make(map[*Client]bool),
		ingress:     make(chan *ClientMessage),
		register:    make(chan *Client),
		unregister:  make(chan *Client),
		llmBaseURL:  llmBaseURL,
	}
}

func (r *Room) Run() {
	defer func() {
		if r.llmCancel != nil {
			r.llmCancel()
		}
		if r.llmSocket != nil {
			r.llmSocket.Close()
		}
	}()

	// Connect to LLM immediately
	r.connectLLM()

	// Idle timeout: close the room if no activity/clients for 5 minutes.
	const idleTimeout = 5 * time.Minute
	timer := time.NewTimer(idleTimeout)
	defer timer.Stop()

	resetTimer := func() {
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(idleTimeout)
	}

	for {
		select {
		case client := <-r.register:
			r.clients[client] = true
			r.logger.Info("client joined room", zap.String("user_id", client.userID.String()))
			// Send initial sync if needed? Client fetches DB history.
			resetTimer()

		case client := <-r.unregister:
			if _, ok := r.clients[client]; ok {
				delete(r.clients, client)
				close(client.send)
				r.logger.Info("client left room", zap.String("user_id", client.userID.String()))
				// If no clients left, timer will eventually kill room.
			}

		case msg := <-r.ingress:
			resetTimer()
			r.handleUserMessage(msg)

		case frame, ok := <-r.llmFrames:
			if !ok {
				r.logger.Warn("llm frames channel closed")
				r.llmFrames = nil // Disable case
				// Should we reconnect? Only on next user message or if needed.
				// For now, let's mark as disconnected.
				r.llmSocket = nil
				continue
			}
			resetTimer()
			r.handleLLMMessage(frame)

		case err, ok := <-r.llmErrs:
			if !ok {
				r.llmErrs = nil
				continue
			}
			r.logger.Error("llm error", zap.Error(err))
			if r.llmSocket != nil {
				r.llmSocket.Close()
				r.llmSocket = nil
			}

		case <-timer.C:
			if len(r.clients) == 0 {
				r.logger.Info("room idle timeout, closing")
				r.hub.unregister <- r
				return
			}
			// If clients exist, reset timer (shouldn't happen if resetTimer works, but safety)
			timer.Reset(idleTimeout)
		}
	}
}

func (r *Room) connectLLM() {
	if r.llmSocket != nil {
		return
	}

	// Build URL
	u, err := buildPathForWS(r.llmBaseURL)
	if err != nil {
		r.logger.Error("failed to build llm url", zap.Error(err))
		return
	}

	query := u.Query()
	query.Add("chat_id", r.ID.String())
	// We don't have model params here yet, or use default.
	// The User Message will carry the model.
	u.RawQuery = query.Encode()

	hdr := http.Header{}
	sessionCookie := fmt.Sprintf("session_id=%s", r.ID.String())
	hdr.Add("Cookie", sessionCookie)

	r.logger.Info("connecting to llm", zap.String("url", u.String()))
	conn, _, err := websocket.DefaultDialer.Dial(u.String(), hdr)
	if err != nil {
		r.logger.Error("failed to dial llm", zap.Error(err))
		return
	}

	r.llmSocket = NewSocketReader(conn, r.logger)
	r.llmCtx, r.llmCancel = context.WithCancel(context.Background())
	r.llmFrames, r.llmErrs = r.llmSocket.Read(r.llmCtx)

	// Send Tools and History
	r.initLLMContext()
}

func (r *Room) initLLMContext() {
	ctx := context.Background() // Use background context for DB ops

	// 1. Send Tools (Integrations)
	tools, err := r.store.GetIntegrations(ctx, r.initiatorID)
	if err != nil {
		r.logger.Error("failed to fetch integrations", zap.Error(err))
	} else {
		toolsPayload := make([]map[string]interface{}, 0, len(tools))
		for _, integration := range tools {
			toolsPayload = append(toolsPayload, map[string]interface{}{
				"name":    integration.Name,
				"enabled": integration.Enabled,
				"params":  integration.Params,
			})
		}


		// user, err := r.store.GetUserByID(ctx, r.initiatorID)
		// if err == nil && user.WebSearchEnabled {
		// 	// Web search is enabled via Python side directly
		// }

		frame := Frame{
			ID:        0,
			ChatID:    r.ID,
			Kind:      TokenKind,
			Operation: ToolsOperation,
			Timestamp: time.Now().UTC(),
			Payload: Payload{
				Tools: map[string]interface{}{
					"tools": toolsPayload,
				},
			},
		}
		if err := r.llmSocket.Write(context.Background(), frame); err != nil {
			r.logger.Error("failed to send tools", zap.Error(err))
		} else {
			r.logger.Info("sent tools to model",
				zap.Int("count", len(toolsPayload)),
				zap.Any("tools_names", func() []string {
					names := make([]string, len(toolsPayload))
					for i, t := range toolsPayload {
						if name, ok := t["name"].(string); ok {
							names[i] = name
						}
					}
					return names
				}()))
		}
	}

	// 2. Send History
	// We load history for the chat.
	messages, err := r.store.GetMessages(ctx, r.initiatorID, r.ID, 50)
	if err != nil {
		r.logger.Warn("failed to load history", zap.Error(err))
	} else if len(messages) > 0 {
		historyData := make([]map[string]interface{}, 0, len(messages))
		for _, msg := range messages {
			historyData = append(historyData, map[string]interface{}{
				"role": string(msg.Role),
				"text": msg.Text,
			})
		}
		frame := Frame{
			ID:        1,
			ChatID:    r.ID,
			Kind:      TokenKind,
			Operation: HistoryOperation,
			Timestamp: time.Now().UTC(),
			Payload: Payload{
				History: historyData,
			},
		}
		if err := r.llmSocket.Write(context.Background(), frame); err != nil {
			r.logger.Error("failed to send history", zap.Error(err))
		}
	}
}

func (r *Room) InjectMessage(userID uuid.UUID, payload []byte) {
	// Create a "fake" client message
	msg := &ClientMessage{
		Client: &Client{
			userID: userID,
			// send:   make(chan []byte), // We don't read from this, so nil is fine? No, broadcast writes to it.
			// Actually, if we pass nil client, we need to handle it in handleUserMessage.
		},
		Payload: payload,
	}
	r.handleUserMessage(msg)
}

func (r *Room) handleUserMessage(msg *ClientMessage) {
	// Parse message
	// The ClientMessage.Payload is JSON bytes of Frame
	// Actually, we could parse it in Client, but doing it here is fine.
	// But ClientMessage payload is []byte.
	// We need to parse it to Frame.
	// Wait, we defined ClientMessage with Payload []byte.

	// Helper to broadcast to all clients
	broadcast := func(f Frame) {
		r.logger.Info("broadcast to clients",
			zap.Int("client_count", len(r.clients)),
			zap.String("op", string(f.Operation)),
			zap.String("role", f.Payload.Role),
		)
		b, _ := json.Marshal(f)
		for client := range r.clients {
			if client.send == nil {
				continue
			}
			select {
			case client.send <- b:
			default:
				close(client.send)
				delete(r.clients, client)
			}
		}
	}

	// Helper to broadcast to all clients EXCEPT the sender
	// Used for user messages to avoid duplication (frontend adds them optimistically)
	broadcastExcept := func(f Frame, sender *Client) {
		b, _ := json.Marshal(f)
		for client := range r.clients {
			// Skip sender if valid (might be nil for system messages)
			if sender != nil && client == sender {
				continue
			}
			// Skip clients with nil send channel (safety)
			if client.send == nil {
				continue
			}
			select {
			case client.send <- b:
			default:
				close(client.send)
				delete(r.clients, client)
			}
		}
	}

	// Suppress unused variable warning
	_ = broadcast
	_ = broadcastExcept

	// Parse
	// We can use a temporary struct or just Frame if it matches.
	// Note: The client sends specific fields.
	// We used generic json unmarshal in streamer.
	// Let's rely on standard Unmarshal.

	// Wait, we need to know the Operation.
	// If it's a "message", we process.
	// If it's "ping", we might ignore or pong? (Client handles pong automatically in readPump if it was control frame, but this is text frame)

	// Let's assume it's a Frame.
	// Note: We need to parse it to struct.
	var frame Frame
	if err := json.Unmarshal(msg.Payload, &frame); err != nil {
		r.logger.Warn("failed to parse user message", zap.Error(err))
		return
	}

	// Basic validation
	if frame.ChatID != uuid.Nil && frame.ChatID != r.ID {
		r.logger.Warn("message chat_id mismatch", zap.String("msg_chat_id", frame.ChatID.String()), zap.String("room_id", r.ID.String()))
		// Force it?
		frame.ChatID = r.ID
	} else {
		frame.ChatID = r.ID
	}

	if frame.Operation == MessageOperation {
		// This is a user message from client
		// 1. Enrich with attachments
		if len(frame.Payload.AttachmentIDs) > 0 {
			atts, err := r.store.GetAttachmentsByIDs(context.Background(), frame.Payload.AttachmentIDs)
			if err != nil {
				r.logger.Error("failed to fetch attachments", zap.Error(err))
			} else {
				var enriched []chat.Attachment
				for _, att := range atts {
					enriched = append(enriched, chat.Attachment{
						ID:       att.ID,
						FileName: att.FileName,
						FileType: att.FileType,
						Size:     att.Size,
						Content:  base64.StdEncoding.EncodeToString(att.Content),
					})
				}
				frame.Payload.Attachments = enriched
			}
		}

		// 2. Save to DB
		senderID := msg.Client.userID

		// Use the messageID from payload if provided, otherwise generate new
		msgID := frame.Payload.MessageID
		if msgID == uuid.Nil || msgID == storage.ZeroUUID {
			msgID = uuid.New()
		}

		err := r.store.UpsertMessage(context.Background(), senderID, &chat.Message{
			ID:        msgID,
			ChatID:    r.ID,
			Sender:    senderID,
			Role:      chat.RoleUser,
			Text:      frame.Payload.Message,
			Model:     frame.Payload.Model,
			CreatedAt: time.Now().UTC(),
		})
		if err != nil {
			r.logger.Error("failed to save user message", zap.Error(err))
		}

		// 3. Set role/sender in frame for multi-device sync
		if frame.Payload.Role != "system" {
			frame.Payload.Role = "user"
		}
		frame.Payload.Sender = senderID
		r.logger.Info("broadcasting user message with role",
			zap.String("role", frame.Payload.Role),
			zap.String("sender", senderID.String()),
			zap.String("message", frame.Payload.Message),
		)

		// 4. Broadcast to OTHER clients (sender already has this message optimistically)
		broadcastExcept(frame, msg.Client)

		// 5. Forward to LLM
		r.connectLLM() // Ensure connected
		if r.llmSocket != nil {
			if err := r.llmSocket.Write(context.Background(), frame); err != nil {
				r.logger.Error("failed to forward to llm", zap.Error(err))
			}
		}
	} else {
		// Pass through other frames (e.g. commands, meta, tools, history)
		broadcast(frame)
		r.connectLLM()
		if r.llmSocket != nil {
			r.llmSocket.Write(context.Background(), frame)
		}
	}
}

func (r *Room) handleLLMMessage(frame Frame) {
	// DEBUG: Log all incoming LLM frames
	r.logger.Info("handleLLMMessage received frame",
		zap.String("kind", string(frame.Kind)),
		zap.String("op", string(frame.Operation)),
		zap.String("chat_id", frame.ChatID.String()),
		zap.String("msg_id", frame.Payload.MessageID.String()),
		zap.String("type", frame.Payload.Type),
		zap.Int("msg_len", len(frame.Payload.Message)),
	)

	// Broadcast to clients
	b, err := json.Marshal(frame)
	if err != nil {
		r.logger.Error("failed to marshal llm frame", zap.Error(err))
		return
	}

	clientCount := len(r.clients)
	r.logger.Debug("broadcasting LLM frame",
		zap.Int("client_count", clientCount),
		zap.String("kind", string(frame.Kind)),
		zap.String("operation", string(frame.Operation)),
	)

	for client := range r.clients {
		select {
		case client.send <- b:
		default:
			close(client.send)
			delete(r.clients, client)
		}
	}

	// DB Persistence (Assistant)
	ctx := context.Background()

	// Handle metadata
	if frame.Operation == MessageOperation && frame.Kind == MetaKind && frame.Payload.Type == "metadata" {
		r.currentMessageMetadata.MessageID = frame.Payload.MessageID
		if frame.Payload.Model != "" {
			r.currentMessageMetadata.Model = frame.Payload.Model
		}
		if frame.Payload.ToolCalls != nil {
			r.currentMessageMetadata.ToolCalls = frame.Payload.ToolCalls
		}
		// Handle ReasoningSteps if present
		// Note: ReasoningSteps are streamed as tokens/deltas, so we concatenate directly.
		if len(frame.Payload.ReasoningSteps) > 0 {
			for _, step := range frame.Payload.ReasoningSteps {
				r.currentMessageMetadata.Reasoning += step
			}
		}

		// Update DB logic - preserve accumulated text, don't overwrite with empty!
		if r.currentMessageMetadata.MessageID != uuid.Nil {
			if err := r.store.UpsertMessage(ctx, r.initiatorID, &chat.Message{
				ID:        r.currentMessageMetadata.MessageID,
				ChatID:    frame.ChatID,
				Sender:    storage.ZeroUUID,
				Role:      chat.RoleAssistant,
				Text:      r.currentMessageMetadata.Text, // FIXED: Use accumulated text
				Reasoning: r.currentMessageMetadata.Reasoning,
				Model:     r.currentMessageMetadata.Model,
				ToolCalls: r.currentMessageMetadata.ToolCalls,
				CreatedAt: time.Now().UTC(),
			}); err != nil {
				r.logger.Error("failed to upsert assistant message (metadata)",
					zap.Error(err),
					zap.String("msg_id", r.currentMessageMetadata.MessageID.String()),
					zap.String("chat_id", frame.ChatID.String()),
				)
			}
		}
	}

	if frame.Operation == MessageOperation && frame.Kind == TokenKind {
		// Reset metadata if this is a new message (different ID)
		if r.currentMessageMetadata.MessageID != frame.Payload.MessageID {
			r.logger.Info("resetting metadata for new message",
				zap.String("old_msg_id", r.currentMessageMetadata.MessageID.String()),
				zap.String("new_msg_id", frame.Payload.MessageID.String()),
				zap.Int("old_text_len", len(r.currentMessageMetadata.Text)),
			)
			r.currentMessageMetadata = struct {
				MessageID uuid.UUID
				Model     string
				ToolCalls interface{}
				Text      string
				Reasoning string
			}{
				MessageID: frame.Payload.MessageID,
			}
		}

		oldLen := len(r.currentMessageMetadata.Text)
		r.currentMessageMetadata.Text += frame.Payload.Message
		newLen := len(r.currentMessageMetadata.Text)

		r.logger.Debug("accumulating LLM text",
			zap.String("msg_id", frame.Payload.MessageID.String()),
			zap.Int("token_len", len(frame.Payload.Message)),
			zap.Int("old_total", oldLen),
			zap.Int("new_total", newLen),
		)

		if err := r.store.UpsertMessage(ctx, r.initiatorID, &chat.Message{
			ID:        frame.Payload.MessageID,
			ChatID:    frame.ChatID,
			Sender:    storage.ZeroUUID, // Assistant
			Role:      chat.RoleAssistant,
			Text:      r.currentMessageMetadata.Text,
			Reasoning: r.currentMessageMetadata.Reasoning,
			Model:     r.currentMessageMetadata.Model,
			ToolCalls: r.currentMessageMetadata.ToolCalls,
			CreatedAt: time.Now().UTC(),
		}); err != nil {
			r.logger.Error("failed to upsert assistant message (token)",
				zap.Error(err),
				zap.String("msg_id", frame.Payload.MessageID.String()),
				zap.String("chat_id", frame.ChatID.String()),
				zap.Int("text_len", len(r.currentMessageMetadata.Text)),
			)
		}
	}

	if frame.Operation == DoneOperation {
		// Reset metadata
		r.currentMessageMetadata = struct {
			MessageID uuid.UUID
			Model     string
			ToolCalls interface{}
			Text      string
			Reasoning string
		}{}
	}
}

// Helper for URL building
func buildPathForWS(baseUrl string) (*url.URL, error) {
	result, err := url.Parse(baseUrl)
	if err != nil {
		return nil, fmt.Errorf("bad upstream base URL: %w", err)
	}
	switch result.Scheme {
	case "http":
		result.Scheme = "ws"
	case "https":
		result.Scheme = "wss"
	}
	if result.Path, err = url.JoinPath(result.Path, "/llm/ws"); err != nil {
		return nil, fmt.Errorf("can't join path: %w", err)
	}
	return result, nil
}
