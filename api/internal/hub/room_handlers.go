package hub

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

func (r *Room) InjectMessage(userID uuid.UUID, payload []byte) {
	// Create a "fake" client message
	msg := &ClientMessage{
		Client: &Client{
			userID: userID,
			// send:   make(chan []byte),
		},
		Payload: payload,
	}
	// Send to ingress channel to be processed by Run loop
	// This ensures we don't access room state concurrently and wakes up the loop
	r.ingress <- msg
}

// BroadcastFrame queues a frame for broadcasting to all clients in this room.
// This is thread-safe and safe to call from other goroutines.
func (r *Room) BroadcastFrame(frame Frame) {
	r.broadcast <- frame
}

// HandleRemoteLLMFrame queues a frame from a remote LLM (via Redis) to be processed
// as an LLM message (persisted as assistant, etc)
func (r *Room) HandleRemoteLLMFrame(frame Frame) {
	r.llmIngress <- frame
}

func (r *Room) handleUserMessage(msg *ClientMessage) {
	// Helper to broadcast to all clients
	broadcast := func(f Frame) {
		// Just log op, not role (requires parsing)
		r.logger.Info("broadcast to clients",
			zap.Int("client_count", len(r.clients)),
			zap.String("op", string(f.Operation)),
		)
		b, _ := json.Marshal(f)
		b = append(b, '\n') // NDJSON
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
		b = append(b, '\n') // NDJSON
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

	// Parse Payload
	var payload UserMessagePayload
	if err := json.Unmarshal(frame.Payload, &payload); err != nil {
		r.logger.Warn("failed to parse user payload", zap.Error(err))
		return
	}

	// Generate TraceID if missing
	if payload.TraceID == "" {
		payload.TraceID = uuid.New().String()
	}
	frame.TraceID = payload.TraceID

	// Preserve original ChatID for routing in User rooms
	originalChatID := frame.ChatID

	// Basic validation - for Chat rooms, warn if mismatch but allow processing
	if frame.ChatID != uuid.Nil && frame.ChatID != r.ID {
		if r.Type == RoomTypeChat {
			r.logger.Warn("message chat_id mismatch in chat room", zap.String("msg_chat_id", frame.ChatID.String()), zap.String("room_id", r.ID.String()))
			frame.ChatID = r.ID
		} else if r.Type == RoomTypeUser {
			// For User rooms, we explicitly ALLOW mismatch because we route based on it
			// We do NOT overwrite frame.ChatID here, so we can use it for routing later
		}
	}
	if frame.ChatID == uuid.Nil {
		frame.ChatID = r.ID
	}

	if frame.Operation == MessageOperation && r.Type == RoomTypeChat {
		// This is a user message from client
		// 1. Enrich with attachments
		if len(payload.AttachmentIDs) > 0 {
			atts, err := r.store.GetAttachmentsByIDs(context.Background(), payload.AttachmentIDs)
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
				// Use interface{} for flexibility or convert to map/struct
				payload.Attachments = enriched
			}
		}

		// 2. Save to DB
		senderID := msg.Client.userID

		// Use the messageID from payload if provided, otherwise generate new
		msgID := payload.MessageID
		if msgID == uuid.Nil || msgID == storage.ZeroUUID {
			msgID = uuid.New()
			payload.MessageID = msgID
		}

		// Determine role
		role := chat.RoleUser
		if payload.Role == string(chat.RoleSystem) {
			role = chat.RoleSystem
		}

		r.logger.Info("saving message to db",
			zap.String("original_payload_role", payload.Role),
			zap.String("determined_role", string(role)),
			zap.String("msg_id", msgID.String()),
		)

		err := r.store.UpsertMessage(context.Background(), senderID, &chat.Message{
			ID:        msgID,
			ChatID:    r.ID,
			Sender:    senderID,
			Role:      role,
			Text:      payload.Message,
			Model:     payload.Model,
			CreatedAt: time.Now().UTC(),
		})
		if err != nil {
			r.logger.Error("failed to save user message", zap.Error(err))
		}

		// Update Chat Title if empty (or default)
		ctx := context.Background()
		c, err := r.store.GetChat(ctx, r.initiatorID, r.ID)
		if err == nil && (c.Title == "" || c.Title == "New Chat") {
			newTitle := payload.Message
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
				// Manually construct payload
				updatePayload := ChatUpdatePayload{
					Type:    PayloadTypeChatUpdate,
					Message: newTitle,
				}
				upBytes, _ := json.Marshal(updatePayload)
				broadcast(Frame{
					ID:        0,
					ChatID:    r.ID,
					Kind:      MetaKind,
					Operation: MessageOperation,
					Timestamp: time.Now().UTC(),
					Payload:   upBytes,
				})
			}
		}

		// 3. Set role/sender in frame for multi-device sync
		if payload.Role != "system" {
			payload.Role = "user"
		}
		// Sender is not in UserMessagePayload but was in Payload struct.
		// We should probably rely on the sender ID being inferred or added if needed.
		// But UserMessagePayload doesn't have Sender field.
		// For broadcast to other clients, they need to know who sent it?
		// Usually the client knows it sent it.
		// Other clients: we can add "sender" to metadata or extend UserMessagePayload?
		// Let's assume the frontend doesn't strictly need it if it's "user" role.

		r.logger.Info("broadcasting user message with role",
			zap.String("role", payload.Role),
			zap.String("sender", senderID.String()),
			zap.String("message", payload.Message),
		)

		// Re-marshal payload to frame
		newPayloadBytes, _ := json.Marshal(payload)
		frame.Payload = newPayloadBytes

		// 4. Broadcast to OTHER clients (sender already has this message optimistically)
		broadcastExcept(frame, msg.Client)

		// 5. Forward to LLM
		// 5. Forward to LLM via Redis
		// Enrich Payload with Mode (AgentType) and Command for the new session building
		if r.mode != "" {
			payload.AgentType = r.mode
		}
		if r.command != "" {
			var cmdMap map[string]interface{}
			if err := json.Unmarshal([]byte(r.command), &cmdMap); err == nil {
				payload.Command = chat.Command(cmdMap)
				if r.mode == "agent" {
					if cmdType, ok := cmdMap["type"].(string); ok && cmdType != "" && cmdType != "agent" {
						payload.AgentType = cmdType
						r.logger.Info("using agent type from command", zap.String("agent_type", cmdType))
					}
				}
			} else {
				// Fallback: wrap string in map if unmarshal fails
				payload.Command = chat.Command{"raw_command": r.command}
			}
		}

		// 5.0.1 Inject task_id and project_id from Chat into command
		chatRecord, err := r.store.GetChat(context.Background(), r.initiatorID, r.ID)
		if err == nil && chatRecord != nil {
			cmdMap := payload.Command
			if cmdMap == nil {
				cmdMap = make(chat.Command)
			}

			if chatRecord.TaskID != nil {
				cmdMap["task_id"] = chatRecord.TaskID.String()
			}

			if chatRecord.ProjectID != nil {
				cmdMap["project_id"] = chatRecord.ProjectID.String()
			}

			payload.Command = cmdMap
		}

		// 5.1 Fetch and Bundle Tools
		var tools []interface{}
		tools = append(tools, map[string]interface{}{"name": "web_search", "enabled": true})
		tools = append(tools, map[string]interface{}{"name": "knowledge_search", "enabled": true, "user_id": r.initiatorID.String()})

		if payload.Tools != nil {
			if clientTools, ok := payload.Tools.([]interface{}); ok && len(clientTools) > 0 {
				r.logger.Info("using client-sent integrations", zap.Int("count", len(clientTools)))
				for _, ct := range clientTools {
					if ctMap, ok := ct.(map[string]interface{}); ok {
						if name, ok := ctMap["name"].(string); ok {
							if name == "web_search" || name == "knowledge_search" {
								continue
							}
						}
						tools = append(tools, ct)
					}
				}
			}
		} else {
			var integrations []storage.Integration
			if err := r.store.DB.Where("user_id = ? AND enabled = ?", r.initiatorID, true).Find(&integrations).Error; err != nil {
				r.logger.Warn("failed to fetch integrations for bundling", zap.Error(err))
			} else {
				r.logger.Info("fetched integrations from DB", zap.Int("count", len(integrations)), zap.String("user_id", r.initiatorID.String()))
				for _, integ := range integrations {
					var paramsMap map[string]interface{}
					if err := json.Unmarshal([]byte(integ.Params), &paramsMap); err != nil {
						paramsMap = make(map[string]interface{})
					}
					paramsMap["name"] = integ.Provider
					paramsMap["enabled"] = true
					tools = append(tools, paramsMap)
				}
			}
		}

		payload.Tools = tools

		// 5.2 Fetch and Bundle Chat History
		messages, err := r.store.GetMessages(ctx, r.initiatorID, r.ID, 50)
		if err != nil {
			r.logger.Warn("failed to load history for bundling", zap.Error(err))
		} else if len(messages) > 0 {
			// handled in finalMap
		}

		// Construct final payload for Redis
		// Since we modified payload (Tools, Command), let's marshal it.
		// But we also need History which is not in UserMessagePayload.
		// So we unmarshal the payload back to map, add History, and send.

		// Set user_id so Python backend knows who to respond to
		payload.UserID = r.initiatorID

		finalPayloadBytes, _ := json.Marshal(payload)
		var finalMap map[string]interface{}
		json.Unmarshal(finalPayloadBytes, &finalMap)

		// Ensure user_id is present in finalMap
		finalMap["user_id"] = r.initiatorID.String()

		if len(messages) > 0 {
			historyData := make([]map[string]interface{}, 0, len(messages))
			for _, msg := range messages {
				historyData = append(historyData, map[string]interface{}{
					"role":    string(msg.Role),
					"content": msg.Text,
				})
			}
			finalMap["history"] = historyData
		}

		// Update frame payload with the map
		finalMapBytes, _ := json.Marshal(finalMap)
		frame.Payload = finalMapBytes

		payloadBytes, _ := json.Marshal(frame)
		r.logger.Info("REDIS PUBLISH",
			zap.String("channel", fmt.Sprintf("chat:request:%s", r.ID.String())),
			zap.String("op", string(frame.Operation)),
			zap.Int("len", len(payloadBytes)),
			zap.String("trace_id", payload.TraceID),
		)

		if err := r.hub.redis.Publish(context.Background(), fmt.Sprintf("chat:request:%s", r.ID.String()), payloadBytes).Err(); err != nil {
			r.logger.Error("failed to publish to redis", zap.Error(err))
		}
		r.generationInProgress = true

	} else if r.Type == RoomTypeChat {
		// Pass through other frames
		broadcast(frame)
		payloadBytes, _ := json.Marshal(frame)
		r.hub.redis.Publish(context.Background(), fmt.Sprintf("chat:request:%s", r.ID.String()), payloadBytes)

	} else {
		// User channel - handle routing and broadcast
		if frame.Operation == MessageOperation && originalChatID != uuid.Nil && originalChatID != r.ID {
			r.routeMessage(msg, frame, originalChatID)
		}
		broadcast(frame)
	}
}

func (r *Room) handleLLMMessage(frame Frame, forwardToUser bool) {
	// DEBUG: Log all incoming LLM frames
	r.logger.Info("handleLLMMessage received frame",
		zap.String("kind", string(frame.Kind)),
		zap.String("op", string(frame.Operation)),
		zap.String("chat_id", frame.ChatID.String()),
		zap.String("trace_id", frame.TraceID),
	)

	// Broadcast to clients
	b, err := json.Marshal(frame)
	if err != nil {
		r.logger.Error("failed to marshal llm frame", zap.Error(err))
		return
	}
	// Append newline for NDJSON
	b = append(b, '\n')

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

	// Forward to User Room if this is a Chat Room
	// This ensures users connected to the global "user" channel receive updates
	if r.Type == RoomTypeChat && forwardToUser {
		userRoom, err := r.hub.GetOrCreateRoom(r.initiatorID, RoomTypeUser, r.initiatorID, "", "")
		if err == nil && userRoom != nil {
			userRoom.BroadcastFrame(frame)
		} else {
			r.logger.Warn("failed to get user room for forwarding", zap.Error(err))
		}
	}

	// DB Persistence (Assistant) - Only for Chat Rooms
	if r.Type != RoomTypeChat {
		return
	}

	// Use Dispatcher for persistence logic
	if frame.Operation == MessageOperation {
		if err := r.DispatchPayload(frame); err != nil {
			r.logger.Error("dispatch failed", zap.Error(err))
		}
	}

	if frame.Operation == DoneOperation {
		// Generation complete - room can now close if no clients
		r.generationInProgress = false
		// Extract message ID from payload if possible
		// But in new model, Done payload might differ.
		// For now, just log.
		r.logger.Info("generation complete")
	}
}
