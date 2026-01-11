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

type RoomType string

const (
	RoomTypeChat RoomType = "chat"
	RoomTypeUser RoomType = "user"
)

type Room struct {
	ID     uuid.UUID
	Type   RoomType
	hub    *Hub
	logger *zap.Logger
	store  *storage.Storage

	// The user who initiated the session (for context/integrations)
	initiatorID uuid.UUID

	clients    map[*Client]bool
	ingress    chan *ClientMessage
	redisIngress chan Frame
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

	// Team Mode
	mode    string // "agent" or "team"
	command string // JSON-encoded team command

	// Generation state - prevents room from closing while LLM is generating
	generationInProgress bool

	// Metadata tracking for current assistant message
	currentMessageMetadata struct {
		MessageID    uuid.UUID
		Model        string
		ToolCalls    interface{}
		Text         string
		Reasoning    string
		ContentParts []interface{}
		Actions      interface{} // D&D action buttons
	}
}

func NewRoom(hub *Hub, id uuid.UUID, roomType RoomType, initiatorID uuid.UUID, store *storage.Storage, logger *zap.Logger, llmBaseURL string, mode string, command string) *Room {
	return &Room{
		ID:           id,
		Type:         roomType,
		hub:          hub,
		logger:       logger.With(zap.String("room_id", id.String()), zap.String("type", string(roomType))),
		store:        store,
		initiatorID:  initiatorID,
		clients:      make(map[*Client]bool),
		ingress:      make(chan *ClientMessage),
		redisIngress: make(chan Frame, 256),
		register:     make(chan *Client),
		unregister:   make(chan *Client),
		llmBaseURL:   llmBaseURL,
		mode:         mode,
		command:      command,
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

	// Connect to LLM immediately ONLY if it's a chat room
	// For user channels, we don't connect to LLM unless needed (future feature)
	if r.Type == RoomTypeChat {
		r.connectLLM()
	}

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

		case frame := <-r.redisIngress:
			resetTimer()
			r.handleLLMMessage(frame)

		case _, ok := <-r.llmFrames:
			if !ok {
				r.logger.Warn("llm frames channel closed, will retry connection on next message")
				r.llmFrames = nil // Disable this case to avoid busy loop
				// Don't set llmSocket = nil here - the connection might still be valid for writes
				// If the next write fails, connectLLM will handle reconnection
				continue
			}
			// We no longer process frames from the WebSocket directly as they come via Redis.
			// However, we might still receive control frames or pings if Python sends them there.
			// But since we told Python to send EVERYTHING to Redis, this channel should stay silent
			// until it closes. If we receive something, we ignore it to avoid duplication.

		case err, ok := <-r.llmErrs:
			if !ok {
				r.llmErrs = nil
				continue
			}
			r.logger.Error("llm error", zap.Error(err))
			// Only reset socket on actual errors
			if r.llmSocket != nil {
				r.llmSocket.Close()
				r.llmSocket = nil
			}

		case <-timer.C:
			if len(r.clients) == 0 && !r.generationInProgress {
				r.logger.Info("room idle timeout, closing")
				r.hub.unregister <- r
				return
			}
			if r.generationInProgress {
				r.logger.Debug("room has no clients but generation in progress, keeping alive")
			}
			// If clients exist, reset timer (shouldn't happen if resetTimer works, but safety)
			timer.Reset(idleTimeout)
		}
	}
}

func (r *Room) connectLLM() {
	// If we have a socket but no frames channel, we need to restart the reader
	if r.llmSocket != nil && r.llmFrames == nil {
		r.logger.Info("restarting LLM reader goroutine")
		// Cancel old context if exists
		if r.llmCancel != nil {
			r.llmCancel()
		}
		r.llmCtx, r.llmCancel = context.WithCancel(context.Background())
		r.llmFrames, r.llmErrs = r.llmSocket.Read(r.llmCtx)
		return
	}

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
	query.Add("user_id", r.initiatorID.String())

	// Forward mode and command to Python backend
	if r.mode != "" {
		query.Add("mode", r.mode)
	}
	if r.command != "" {
		query.Add("command", r.command)
	}

	u.RawQuery = query.Encode()

	hdr := http.Header{}
	sessionCookie := fmt.Sprintf("session_id=%s", r.ID.String())
	hdr.Add("Cookie", sessionCookie)

	r.logger.Info("connecting to llm", zap.String("url", u.String()), zap.String("mode", r.mode))
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

func (r *Room) HandleRedisFrame(frame Frame) {
	select {
	case r.redisIngress <- frame:
	default:
		r.logger.Warn("redis ingress full, dropping frame", zap.String("op", string(frame.Operation)))
	}
}

func (r *Room) initLLMContext() {
	// Only chat rooms need history context
	if r.Type != RoomTypeChat {
		return
	}

	ctx := context.Background() // Use background context for DB ops

	// 1. Send Tools (Integrations) - REMOVED (Client-side keys only)

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

	if frame.Operation == MessageOperation && r.Type == RoomTypeChat {
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

		// Determine role
		role := chat.RoleUser
		if frame.Payload.Role == string(chat.RoleSystem) {
			role = chat.RoleSystem
		}

		r.logger.Info("saving message to db",
			zap.String("original_payload_role", frame.Payload.Role),
			zap.String("determined_role", string(role)),
			zap.String("msg_id", msgID.String()),
		)

		err := r.store.UpsertMessage(context.Background(), senderID, &chat.Message{
			ID:        msgID,
			ChatID:    r.ID,
			Sender:    senderID,
			Role:      role,
			Text:      frame.Payload.Message,
			Model:     frame.Payload.Model,
			CreatedAt: time.Now().UTC(),
		})
		if err != nil {
			r.logger.Error("failed to save user message", zap.Error(err))
		}

		// Update Chat Title if empty (or default)
		ctx := context.Background()
		c, err := r.store.GetChat(ctx, r.initiatorID, r.ID)
		if err == nil && (c.Title == "" || c.Title == "New Chat") {
			newTitle := frame.Payload.Message
			runes := []rune(newTitle)
			if len(runes) > 50 {
				newTitle = string(runes[:50]) + "..."
			}
			if newTitle == "" {
				newTitle = "Chat"
			}

			c.Title = newTitle
			if _, err := r.store.UpdateChat(ctx, r.initiatorID, c); err != nil {
				r.logger.Error("failed to update chat title", zap.Error(err))
			} else {
				r.logger.Info("updated chat title", zap.String("new_title", newTitle))

				// Broadcast title update to client
				broadcast(Frame{
					ID:        0,
					ChatID:    r.ID,
					Kind:      MetaKind,
					Operation: MessageOperation,
					Timestamp: time.Now().UTC(),
					Payload: Payload{
						Type:    "chat_update",
						Message: newTitle,
					},
				})
			}
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
			r.generationInProgress = true // Keep room alive until response complete
			if err := r.llmSocket.Write(context.Background(), frame); err != nil {
				r.logger.Error("failed to forward to llm", zap.Error(err))
				r.generationInProgress = false
			}
		}
	} else if r.Type == RoomTypeChat {
		// Pass through other frames (e.g. commands, meta, tools, history) for CHAT rooms
		broadcast(frame)
		r.connectLLM()
		if r.llmSocket != nil {
			r.llmSocket.Write(context.Background(), frame)
		}
	} else {
		// User channel - basically just broadcast or ignore.
		// For now, simple echo/broadcast to other devices of same user
		broadcast(frame)
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

	// DB Persistence (Assistant) - Only for Chat Rooms
	if r.Type != RoomTypeChat {
		return
	}

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
			stepContent := ""
			for _, step := range frame.Payload.ReasoningSteps {
				r.currentMessageMetadata.Reasoning += step
				stepContent += step
			}

			// Append to ContentParts
			parts := r.currentMessageMetadata.ContentParts
			if len(parts) > 0 {
				lastPart := parts[len(parts)-1].(map[string]interface{})
				if lastPart["type"] == "reasoning" {
					lastPart["reasoning"] = lastPart["reasoning"].(string) + stepContent
					parts[len(parts)-1] = lastPart
				} else {
					parts = append(parts, map[string]interface{}{
						"type":      "reasoning",
						"reasoning": stepContent,
					})
				}
			} else {
				parts = append(parts, map[string]interface{}{
					"type":      "reasoning",
					"reasoning": stepContent,
				})
			}
			r.currentMessageMetadata.ContentParts = parts
		}

		// Update DB logic - preserve accumulated text, don't overwrite with empty!
		if r.currentMessageMetadata.MessageID != uuid.Nil {
			if err := r.store.UpsertMessage(ctx, r.initiatorID, &chat.Message{
				ID:           r.currentMessageMetadata.MessageID,
				ChatID:       frame.ChatID,
				Sender:       storage.ZeroUUID,
				Role:         chat.RoleAssistant,
				Text:         r.currentMessageMetadata.Text, // FIXED: Use accumulated text
				Reasoning:    r.currentMessageMetadata.Reasoning,
				Model:        r.currentMessageMetadata.Model,
				ToolCalls:    r.currentMessageMetadata.ToolCalls,
				ContentParts: r.currentMessageMetadata.ContentParts,
				Actions:      r.currentMessageMetadata.Actions,
				CreatedAt:    time.Now().UTC(),
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
				MessageID    uuid.UUID
				Model        string
				ToolCalls    interface{}
				Text         string
				Reasoning    string
				ContentParts []interface{}
				Actions      interface{}
			}{
				MessageID: frame.Payload.MessageID,
			}
		}

		shouldUpsert := false

		parts := r.currentMessageMetadata.ContentParts

		// Handle Tool Call
		if frame.Payload.Type == "tool_call" && frame.Payload.Tool != nil {
			// Append tool call to metadata
			var currentTools []interface{}
			if r.currentMessageMetadata.ToolCalls != nil {
				if ct, ok := r.currentMessageMetadata.ToolCalls.([]interface{}); ok {
					currentTools = ct
				}
			}
			currentTools = append(currentTools, frame.Payload.Tool)
			r.currentMessageMetadata.ToolCalls = currentTools

			// Append to ContentParts
			parts = append(parts, map[string]interface{}{
				"type":      "tool_call",
				"tool_call": frame.Payload.Tool,
			})
			r.currentMessageMetadata.ContentParts = parts

			shouldUpsert = true

			r.logger.Info("accumulating tool call",
				zap.String("msg_id", frame.Payload.MessageID.String()),
				zap.Any("tool", frame.Payload.Tool),
			)

			if toolMap, ok := frame.Payload.Tool.(map[string]interface{}); ok {
				if name, ok := toolMap["name"].(string); ok && name == "suggest_actions" {
					if args, ok := toolMap["arguments"].(map[string]interface{}); ok {
						if actions, ok := args["actions"].([]interface{}); ok {
							// Normalize actions to ensure they are objects with label/prompt/command
							normalizedActions := make([]interface{}, 0, len(actions))
							for _, act := range actions {
								if actStr, ok := act.(string); ok {
									// Convert string to object
									normalizedActions = append(normalizedActions, map[string]interface{}{
										"label":   actStr,
										"prompt":  actStr,
										"command": "dnd_action",
									})
								} else {
									// Already an object or other type, keep as is
									normalizedActions = append(normalizedActions, act)
								}
							}

							r.currentMessageMetadata.Actions = normalizedActions
							r.logger.Info("intercepted suggest_actions, saving normalized actions to metadata",
								zap.Int("count", len(normalizedActions)))
						}
					}
				}
			}
		} else if frame.Payload.Type == "actions" && frame.Payload.Actions != nil {
			// Handle D&D action buttons
			r.currentMessageMetadata.Actions = frame.Payload.Actions
			shouldUpsert = true

			r.logger.Info("storing actions",
				zap.String("msg_id", frame.Payload.MessageID.String()),
				zap.Any("actions", frame.Payload.Actions),
			)
		} else if frame.Payload.Type == "reasoning" {
			// Handle Reasoning
			// ws.py sends reasoning in 'content' field
			textDelta := frame.Payload.Content
			if textDelta == "" {
				textDelta = frame.Payload.Message // Fallback
			}

			if textDelta != "" {
				r.currentMessageMetadata.Reasoning += textDelta

				// Append/Update ContentParts
				if len(parts) > 0 {
					lastPart := parts[len(parts)-1].(map[string]interface{})
					if lastPart["type"] == "reasoning" {
						lastPart["reasoning"] = lastPart["reasoning"].(string) + textDelta
						parts[len(parts)-1] = lastPart
					} else {
						parts = append(parts, map[string]interface{}{
							"type":      "reasoning",
							"reasoning": textDelta,
						})
					}
				} else {
					parts = append(parts, map[string]interface{}{
						"type":      "reasoning",
						"reasoning": textDelta,
					})
				}
				r.currentMessageMetadata.ContentParts = parts
				shouldUpsert = true
				r.logger.Debug("accumulating reasoning",
					zap.String("msg_id", frame.Payload.MessageID.String()),
					zap.Int("delta_len", len(textDelta)),
				)
			}
		} else if frame.Payload.Type == "member_response" {
			// Handle Team Member Response
			// ws.py sends content in 'message' field for member_response
			textDelta := frame.Payload.Message
			agentName := frame.Payload.AgentName

			if textDelta != "" {
				// Append/Update ContentParts
				if len(parts) > 0 {
					lastPart := parts[len(parts)-1].(map[string]interface{})
					if lastPart["type"] == "member_response" && lastPart["agent_name"] == agentName {
						lastPart["text"] = lastPart["text"].(string) + textDelta
						parts[len(parts)-1] = lastPart
					} else {
						parts = append(parts, map[string]interface{}{
							"type":       "member_response",
							"agent_name": agentName,
							"text":       textDelta,
						})
					}
				} else {
					parts = append(parts, map[string]interface{}{
						"type":       "member_response",
						"agent_name": agentName,
						"text":       textDelta,
					})
				}
				r.currentMessageMetadata.ContentParts = parts
				shouldUpsert = true
				r.logger.Debug("accumulating member response",
					zap.String("msg_id", frame.Payload.MessageID.String()),
					zap.String("agent", agentName),
					zap.Int("delta_len", len(textDelta)),
				)
			}
		} else {
			// Handle Text
			textDelta := frame.Payload.Message

			oldLen := len(r.currentMessageMetadata.Text)
			r.currentMessageMetadata.Text += textDelta
			newLen := len(r.currentMessageMetadata.Text)

			if newLen > oldLen {
				// Append to ContentParts
				if len(parts) > 0 {
					lastPart := parts[len(parts)-1].(map[string]interface{})
					if lastPart["type"] == "text" {
						lastPart["text"] = lastPart["text"].(string) + textDelta
						parts[len(parts)-1] = lastPart
					} else {
						parts = append(parts, map[string]interface{}{
							"type": "text",
							"text": textDelta,
						})
					}
				} else {
					parts = append(parts, map[string]interface{}{
						"type": "text",
						"text": textDelta,
					})
				}
				r.currentMessageMetadata.ContentParts = parts

				shouldUpsert = true
				r.logger.Debug("accumulating LLM text",
					zap.String("msg_id", frame.Payload.MessageID.String()),
					zap.Int("token_len", len(frame.Payload.Message)),
					zap.Int("old_total", oldLen),
					zap.Int("new_total", newLen),
				)
			}
		}

		if shouldUpsert {
			if err := r.store.UpsertMessage(ctx, r.initiatorID, &chat.Message{
				ID:           frame.Payload.MessageID,
				ChatID:       frame.ChatID,
				Sender:       storage.ZeroUUID, // Assistant
				Role:         chat.RoleAssistant,
				Text:         r.currentMessageMetadata.Text,
				Reasoning:    r.currentMessageMetadata.Reasoning,
				Model:        r.currentMessageMetadata.Model,
				ToolCalls:    r.currentMessageMetadata.ToolCalls,
				ContentParts: r.currentMessageMetadata.ContentParts,
				Actions:      r.currentMessageMetadata.Actions,
				CreatedAt:    time.Now().UTC(),
			}); err != nil {
				r.logger.Error("failed to upsert assistant message (token)",
					zap.Error(err),
					zap.String("msg_id", frame.Payload.MessageID.String()),
					zap.String("chat_id", frame.ChatID.String()),
					zap.Int("text_len", len(r.currentMessageMetadata.Text)),
				)
			}
		}
	}

	if frame.Operation == DoneOperation {
		// Generation complete - room can now close if no clients
		r.generationInProgress = false
		r.logger.Info("generation complete", zap.String("msg_id", frame.Payload.MessageID.String()))

		// Reset metadata
		r.currentMessageMetadata = struct {
			MessageID    uuid.UUID
			Model        string
			ToolCalls    interface{}
			Text         string
			Reasoning    string
			ContentParts []interface{}
			Actions      interface{}
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
