package hub

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/crypto"
	intgr "github.com/kliuchnikovv/genie-api/internal/integrations"
	"github.com/kliuchnikovv/genie-api/internal/plugins"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

// sendErrorFrame logs an error and sends an error frame to all clients in the room
func (r *Room) sendErrorFrame(code string, message string, err error, traceID string, details map[string]interface{}) {
	// Log error with full context
	logFields := []zap.Field{
		zap.String("error_code", code),
		zap.String("chat_id", r.ID.String()),
		zap.String("user_id", r.initiatorID.String()),
		zap.String("message", message),
	}
	if traceID != "" {
		logFields = append(logFields, zap.String("trace_id", traceID))
	}
	if err != nil {
		logFields = append(logFields, zap.Error(err))
	}
	r.logger.Error("sending error frame to clients", logFields...)

	// Create error frame
	errorFrame := Frame{
		ID:        0,
		ChatID:    r.ID,
		TraceID:   traceID,
		Kind:      ErrorKind,
		Operation: ErrorOperation,
		Timestamp: time.Now().UTC(),
		Error: ErrorInfo{
			Code:     code,
			CodeHTTP: 500,
			Message:  message,
			Details:  details,
		},
	}

	// Marshal and broadcast to all clients
	b, marshalErr := json.Marshal(errorFrame)
	if marshalErr != nil {
		r.logger.Error("failed to marshal error frame", zap.Error(marshalErr))
		return
	}
	b = append(b, '\n') // NDJSON

	for client := range r.clients {
		if client.send == nil {
			continue
		}
		select {
		case client.send <- b:
		default:
			// Channel full, close and remove client
			close(client.send)
			delete(r.clients, client)
		}
	}
}

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

	// Parse
	var frame Frame
	if err := json.Unmarshal(msg.Payload, &frame); err != nil {
		r.logger.Warn("failed to parse user message", zap.Error(err))
		// Try to extract trace_id from raw payload if possible
		traceID := ""
		var rawFrame map[string]interface{}
		if json.Unmarshal(msg.Payload, &rawFrame) == nil {
			if tid, ok := rawFrame["trace_id"].(string); ok {
				traceID = tid
			}
		}
		r.sendErrorFrame(ErrorCodeParseFailed, "Failed to parse message", err, traceID, map[string]interface{}{
			"operation": "parse_message",
		})
		return
	}

	// Handle store_facts (async client-extracted facts) — call Python HTTP endpoint directly
	// HTTP is more reliable than Redis pub/sub for this request-response flow
	if frame.Operation == StoreFactsOperation {
		var storePayload StoreFactsPayload
		if err := json.Unmarshal(frame.Payload, &storePayload); err != nil {
			r.logger.Warn("failed to parse store_facts payload", zap.Error(err))
			return
		}
		userID := storePayload.UserID
		if userID == "" {
			userID = r.initiatorID.String()
		}
		if userID == "" || len(storePayload.ExtractedFacts) == 0 {
			return
		}
		// Call Python backend via HTTP
		go func() {
			pythonURL := os.Getenv("LLM_BASE_URL")
			if pythonURL == "" {
				pythonURL = "http://localhost:7777"
			}
			// Strip trailing slash for consistent URL building
			if len(pythonURL) > 0 && pythonURL[len(pythonURL)-1] == '/' {
				pythonURL = pythonURL[:len(pythonURL)-1]
			}
			payload := map[string]interface{}{
				"user_id":         userID,
				"extracted_facts": storePayload.ExtractedFacts,
			}
			body, _ := json.Marshal(payload)
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			req, err := http.NewRequestWithContext(ctx, "POST", pythonURL+"/api/store-facts", bytes.NewReader(body))
			if err != nil {
				r.logger.Error("failed to create store_facts request", zap.Error(err))
				return
			}
			req.Header.Set("Content-Type", "application/json")
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				r.logger.Error("failed to call store_facts", zap.Error(err), zap.String("url", pythonURL+"/api/store-facts"))
				return
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				r.logger.Warn("store_facts returned non-200", zap.Int("status", resp.StatusCode))
				return
			}
			r.logger.Info("store_facts succeeded", zap.String("user_id", userID), zap.Int("count", len(storePayload.ExtractedFacts)))
		}()
		return
	}

	// Handle stop operation - cancel generation
	if frame.Operation == StopOperation {
		// Route to the correct room if chat_id doesn't match (e.g. project chat stop sent via global chat socket)
		if frame.ChatID != uuid.Nil && frame.ChatID != r.ID && r.Type == RoomTypeChat {
			if targetRoom, err := r.hub.GetOrCreateRoom(frame.ChatID, RoomTypeChat, r.initiatorID, r.mode, r.command, r.timezone); err == nil && targetRoom.ID != r.ID {
				targetRoom.ingress <- msg
				return
			}
		}
		r.logger.Info("stop operation received, cancelling generation")
		r.generationInProgress = false
		if r.generationTimer != nil {
			r.generationTimer.Stop()
			r.generationTimer = nil
		}
		r.flushAllBuilders()
		// Broadcast stop signal to all clients
		stopFrame := Frame{
			ID:        0,
			ChatID:    r.ID,
			Kind:      SignalKind,
			Operation: StopOperation,
			Timestamp: time.Now().UTC(),
			Payload:   json.RawMessage(`{"type": "stopped"}`),
		}
		b, _ := json.Marshal(stopFrame)
		b = append(b, '\n')
		for client := range r.clients {
			select {
			case client.send <- b:
			default:
			}
		}
		return
	}

	var payload UserMessagePayload
	if err := json.Unmarshal(frame.Payload, &payload); err != nil {
		r.logger.Warn("failed to parse user payload", zap.Error(err))
		r.sendErrorFrame(ErrorCodeParseFailed, "Failed to parse message payload", err, frame.TraceID, map[string]interface{}{
			"operation": "parse_payload",
			"chat_id":   frame.ChatID.String(),
		})
		return
	}

	// Generate TraceID if missing
	if payload.TraceID == "" {
		payload.TraceID = uuid.New().String()
	}
	frame.TraceID = payload.TraceID

	// Preserve original ChatID for routing in User rooms
	originalChatID := frame.ChatID

	// Basic validation / routing:
	// - For Chat rooms, if the incoming frame.ChatID doesn't match the room ID, it means
	//   the client is sending a message for a different chat while connected to this room.
	//   In that case we MUST route the message to the correct chat room, otherwise the
	//   reply will be published/broadcast to the wrong chat and the UI will appear "stuck".
	if frame.ChatID != uuid.Nil && frame.ChatID != r.ID {
		if r.Type == RoomTypeChat {
			msgChatID := frame.ChatID
			r.logger.Warn(
				"message chat_id mismatch in chat room; rerouting to correct room",
				zap.String("msg_chat_id", msgChatID.String()),
				zap.String("room_id", r.ID.String()),
			)

			// Route to the correct chat room and stop processing in this room.
			// We reuse the same client message payload; the target room will parse it again.
			if targetRoom, err := r.hub.GetOrCreateRoom(msgChatID, RoomTypeChat, r.initiatorID, r.mode, r.command, r.timezone); err != nil {
				r.logger.Error("failed to get/create target chat room for reroute", zap.Error(err), zap.String("msg_chat_id", msgChatID.String()))
			} else if targetRoom.ID != r.ID {
				targetRoom.ingress <- msg
				return
			}
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
				// Send error frame but continue processing (non-critical)
				r.sendErrorFrame(ErrorCodeAttachmentFailed, "Failed to fetch attachments", err, payload.TraceID, map[string]interface{}{
					"operation":      "fetch_attachments",
					"attachment_ids": payload.AttachmentIDs,
				})
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

		ctx := context.Background()

		// Resolve agent storage mode and fetch history BEFORE saving the current
		// message so it is not duplicated in both the history payload and the
		// "new message" field sent to Python.
		agentStorageMode := "payload"
		if user, err := r.store.GetUserByID(ctx, r.initiatorID); err == nil && user.AgentStorageMode != "" {
			agentStorageMode = user.AgentStorageMode
		}
		var historyMessages []*chat.Message
		if agentStorageMode != "agno" {
			var err error
			historyMessages, err = r.store.GetMessages(ctx, r.initiatorID, r.ID, 50)
			if err != nil {
				r.logger.Warn("failed to load history for bundling", zap.Error(err))
			}
		}

		err := r.store.UpsertMessage(ctx, senderID, &chat.Message{
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
			r.sendErrorFrame(ErrorCodeSaveFailed, "Failed to save message to database", err, payload.TraceID, map[string]interface{}{
				"operation":  "save_message",
				"message_id": msgID.String(),
			})
			return
		}

		// A user message is always considered meaningful chat activity.
		_ = r.store.TouchChatActivity(ctx, r.ID, time.Now().UTC())

		// Update Chat Title if empty (or default)
		// Reuse the same ctx for updating title and activity.
		c, err := r.store.GetChat(ctx, r.initiatorID, r.ID)
		if err == nil && (c.Title == "" || c.Title == "New Chat" || c.Title == "Chat") {
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

			payload.Command = cmdMap
		}

		// 5.1 Fetch and Bundle Tools
		var tools []interface{}
		tools = append(tools, map[string]interface{}{"name": "web_search", "enabled": true})
		knowledgeEntry := map[string]interface{}{"name": "knowledge_search", "enabled": true, "user_id": r.initiatorID.String()}
		tools = append(tools, knowledgeEntry)

		// Add Server Plugins (execution.type: server or hybrid)
		// These are auto-included since they don't require user-specific integration/auth
		for _, manifest := range plugins.Manifests {
			if manifest.Execution.Type != "server" && manifest.Execution.Type != "hybrid" {
				continue
			}
			// Skip if include=false in manifest
			if !manifest.GetInclude() {
				continue
			}
			toolParams := map[string]interface{}{}
			if manifest.Execution.Type == "server" {
				toolParams["user_id"] = r.initiatorID.String()
			}
			tools = append(tools, map[string]interface{}{
				"name":    manifest.Name,
				"enabled": true,
				"params":  toolParams,
			})
		}

		// Add Client-only Plugins (execution.type: client)
		// Stored only in local SQLite on device — never synced to server DB.
		// Always included so Python can generate client proxy tools and route via client_action frames.
		for _, manifest := range plugins.Manifests {
			if manifest.Execution.Type != "client" {
				continue
			}
			if !manifest.GetInclude() {
				continue
			}
			tools = append(tools, map[string]interface{}{
				"name":    manifest.Name,
				"enabled": true,
				"params":  map[string]interface{}{},
			})
		}

		// Always fetch latest integrations from DB to get server-side tokens
		var integrations []storage.Integration
		if err := r.store.DB.Where("user_id = ? AND enabled = ?", r.initiatorID, true).Find(&integrations).Error; err != nil {
			r.logger.Warn("failed to fetch integrations for bundling", zap.Error(err))
		}

		// Map of provider name -> params for enrichment
		dbIntegrations := make(map[string]map[string]interface{})
		for _, integ := range integrations {
			var paramsMap map[string]interface{}
			if err := json.Unmarshal([]byte(integ.Params), &paramsMap); err == nil {
				dbIntegrations[integ.Provider] = paramsMap
			}
		}

		// Load OAuth tokens per provider.
		// Each provider uses its own credentials — no fallback to shared tokens.
		providerCredentials := make(map[string]map[string]interface{})
		for _, integ := range integrations {
			provider, ok := intgr.GetProvider(integ.Provider)
			if !ok || provider.OAuthConfigKey == "" {
				continue
			}
			if _, exists := providerCredentials[integ.Provider]; exists {
				continue
			}
			oauthToken, err := r.store.GetOAuthTokenByUserAndEmail(
				context.Background(), r.initiatorID, integ.Provider, integ.AccountEmail,
			)
			if err != nil {
				continue
			}
			decrypted, err := crypto.Decrypt(r.hub.cryptoKey, oauthToken.TokenEncrypted)
			if err != nil {
				continue
			}
			var tokenData map[string]interface{}
			if err := json.Unmarshal(decrypted, &tokenData); err != nil {
				continue
			}
			atStr, _ := tokenData["access_token"].(string)
			if atStr == "" {
				continue
			}
			providerCredentials[integ.Provider] = tokenData
		}

		// Inject provider credentials into server-side integrations that lack them
		for providerName, params := range dbIntegrations {
			providerCreds, hasCreds := providerCredentials[providerName]
			if !hasCreds {
				continue
			}
			for k, v := range providerCreds {
				params[k] = v
			}
		}

		if payload.Tools != nil {
			if clientTools, ok := payload.Tools.([]interface{}); ok && len(clientTools) > 0 {
				r.logger.Info("grouping client-sent integrations by provider", zap.Int("count", len(clientTools)))

				// Group client tools by provider to support multiple accounts
				type providerEntry struct {
					provider     string
					accounts     []map[string]interface{}
					mergedParams map[string]interface{} // credentials keyed by account_id
				}
				providerMap := make(map[string]*providerEntry)

				for _, ct := range clientTools {
					if ctMap, ok := ct.(map[string]interface{}); ok {
						name, _ := ctMap["name"].(string)
						provider, _ := ctMap["provider"].(string)
						if name == "web_search" || name == "knowledge_search" {
							continue
						}

						// Try to find matching integration in DB
						providerToMatch := provider
						if providerToMatch == "" {
							nameLower := strings.ToLower(name)
							// Match against known provider IDs in DB
							for pName := range dbIntegrations {
								if strings.Contains(nameLower, strings.ToLower(pName)) {
									providerToMatch = pName
									break
								}
							}
							// Match against display names in registry
							if providerToMatch == "" {
								for _, def := range intgr.Registry {
									if def.DisplayName != "" && strings.Contains(nameLower, strings.ToLower(def.DisplayName)) {
										providerToMatch = def.Name
										break
									}
								}
							}
							if providerToMatch == "" {
								providerToMatch = name // Final fallback
							}
						}

						// Skip if no matching provider in DB (no credentials to enrich)
						if _, exists := dbIntegrations[providerToMatch]; !exists {
							r.logger.Debug("tool has no matching DB integration", zap.String("tool", name), zap.String("provider", providerToMatch))
							continue
						}

						// Get or create provider entry
						entry, exists := providerMap[providerToMatch]
						if !exists {
							entry = &providerEntry{
								provider:     providerToMatch,
								mergedParams: make(map[string]interface{}),
							}
							providerMap[providerToMatch] = entry
						}

						// Enrich client params with DB credentials
						clientParams, _ := ctMap["params"].(map[string]interface{})
						if clientParams == nil {
							clientParams = make(map[string]interface{})
						}
						if dbParams, exists := dbIntegrations[providerToMatch]; exists {
							for k, v := range dbParams {
								if _, ok := clientParams[k]; !ok {
									clientParams[k] = v
								}
							}
						}

						// Extract account info
						accountID := ""
						displayName := ""
						if id, ok := clientParams["account_id"].(string); ok {
							accountID = id
						}
						if dn, ok := clientParams["display_name"].(string); ok {
							displayName = dn
						} else if email, ok := clientParams["account_email"].(string); ok {
							displayName = email
						}
						if accountID == "" {
							accountID = uuid.New().String()
						}

						// Add account to list and store credentials
						entry.accounts = append(entry.accounts, map[string]interface{}{
							"id":           accountID,
							"display_name": displayName,
						})
						entry.mergedParams[accountID] = clientParams
					}
				}

				// Inject provider credentials into client-sent tools
				for providerName, entry := range providerMap {
					providerCreds, hasCreds := providerCredentials[providerName]
					if !hasCreds {
						continue
					}
					for accID, accParams := range entry.mergedParams {
						if cm, ok := accParams.(map[string]interface{}); ok {
							if at, ok := cm["access_token"].(string); ok && at != "" {
								continue
							}
							for k, v := range providerCreds {
								cm[k] = v
							}
							r.logger.Info("injected provider credentials into client-sent tool",
								zap.String("provider", providerName),
								zap.String("account_id", accID),
							)
						}
					}
				}

				// Build tools from grouped entries
				for providerName, entry := range providerMap {
					toolItem := map[string]interface{}{
						"name":     providerName,
						"provider": providerName,
						"enabled":  true,
						"params": map[string]interface{}{
							"accounts":    entry.accounts,
							"credentials": entry.mergedParams,
						},
					}
					tools = append(tools, toolItem)
					r.logger.Info("grouped tool", zap.String("provider", providerName), zap.Int("accounts", len(entry.accounts)))
				}
			}
		} else {
			r.logger.Info("using integrations from DB", zap.Int("count", len(integrations)))
			for _, integ := range integrations {
				params := dbIntegrations[integ.Provider]
				if params == nil {
					params = make(map[string]interface{})
				}
				// Ensure provider name is set for manifest matching in Python
				toolItem := map[string]interface{}{
					"name":     integ.Provider,
					"provider": integ.Provider,
					"enabled":  true,
					"params":   params,
				}
				tools = append(tools, toolItem)
			}
		}

		payload.Tools = tools

		// Log final tools payload before sending to Redis
		for _, t := range tools {
			if tMap, ok := t.(map[string]interface{}); ok {
				name, _ := tMap["name"].(string)
				r.logger.Info("tool included in redis payload",
					zap.String("tool", name),
				)
			}
		}

		// 5.2/5.3 agent storage mode and history already resolved above (before UpsertMessage).

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
		finalMap["agent_storage_mode"] = agentStorageMode
		finalMap["streaming"] = r.hub.Streaming(payload.Model)
		if payload.AuthToken != "" {
			finalMap["auth_token"] = payload.AuthToken
		}

		// Add timezone for Python backend to use in agent instructions
		if r.timezone != "" {
			finalMap["timezone"] = r.timezone
		}

		// Inject bot identity so Python backend can customise agent name/instructions/tone
		if botIdentity, err := r.store.GetBotIdentity(ctx, r.initiatorID); err == nil {
			finalMap["bot_identity"] = map[string]interface{}{
				"name":         botIdentity.Name,
				"instructions": botIdentity.Instructions,
				"tone":         botIdentity.Tone,
			}
		}

		if len(historyMessages) > 0 {
			historyData := make([]map[string]interface{}, 0, len(historyMessages))
			for _, msg := range historyMessages {
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

		r.currentModelID = payload.Model

		payloadBytes, _ := json.Marshal(frame)
		r.logger.Info("REDIS PUBLISH",
			zap.String("channel", fmt.Sprintf("chat:request:%s", r.ID.String())),
			zap.String("op", string(frame.Operation)),
			zap.Int("len", len(payloadBytes)),
			zap.String("trace_id", payload.TraceID),
		)

		if err := r.hub.redis.Publish(context.Background(), fmt.Sprintf("chat:request:%s", r.ID.String()), payloadBytes).Err(); err != nil {
			r.logger.Error("failed to publish to redis", zap.Error(err))
			// CRITICAL: This prevents the message from reaching the Python backend
			r.sendErrorFrame(ErrorCodeRedisFailed, "Failed to forward message to AI backend", err, payload.TraceID, map[string]interface{}{
				"operation": "redis_publish",
				"channel":   fmt.Sprintf("chat:request:%s", r.ID.String()),
			})
			// Reset generation state since we failed to send
			r.generationInProgress = false
		} else {
			r.generationInProgress = true
			// Start generation timeout timer — sends signal through a channel so the
			// room select loop handles it (avoids concurrent access to r.clients).
			if r.generationTimer != nil {
				r.generationTimer.Stop()
			}
			timeoutCh := r.generationTimeoutCh
			r.generationTimer = time.AfterFunc(10*time.Minute, func() {
				select {
				case timeoutCh <- struct{}{}:
				default:
				}
			})
		}

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

// flushAllBuilders persists all in-progress message builders to the DB.
// Called on graceful shutdown events (STOP, timeout) so partial responses are saved.
func (r *Room) flushAllBuilders() {
	ctx := context.Background()
	for _, builder := range r.messageBuilders {
		if err := builder.Persist(ctx, r.store, r.initiatorID); err != nil {
			r.logger.Error("failed to flush builder", zap.Error(err), zap.String("message_id", builder.ID.String()))
		}
	}
	r.messageBuilders = make(map[uuid.UUID]*MessageBuilder)
}

func (r *Room) handleLLMMessage(frame Frame, forwardToUser bool) {
	// DEBUG: Log all incoming LLM frames
	r.logger.Info("handleLLMMessage received frame",
		zap.String("kind", string(frame.Kind)),
		zap.String("op", string(frame.Operation)),
		zap.String("chat_id", frame.ChatID.String()),
		zap.String("trace_id", frame.TraceID),
	)

	// Only process LLM frames in the chat room that matches frame.ChatID.
	// User rooms receive all frames (fallback for "user-only" clients); other chat rooms skip.
	if r.Type == RoomTypeChat && frame.ChatID != uuid.Nil && frame.ChatID != r.ID {
		return
	}

	// Broadcast to clients
	b, err := json.Marshal(frame)
	if err != nil {
		r.logger.Error("failed to marshal llm frame", zap.Error(err))
		// Send error frame to clients about the marshal failure
		r.sendErrorFrame(ErrorCodeMarshalFailed, "Failed to process AI response", err, frame.TraceID, map[string]interface{}{
			"operation": "marshal_llm_frame",
			"kind":      string(frame.Kind),
			"op":        string(frame.Operation),
		})
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

	// Buffer frame for reconnecting clients (capped at maxReplayBuf).
	if r.generationInProgress || frame.Operation == MessageOperation {
		var msgID uuid.UUID
		if frame.ChatID != uuid.Nil {
			msgID = frame.ChatID
		}
		r.replayMu.Lock()
		r.replaySeq++
		entry := replayEntry{seq: r.replaySeq, msgID: msgID, data: b}
		if len(r.replayBuf) >= maxReplayBuf {
			r.replayBuf = append(r.replayBuf[1:], entry)
		} else {
			r.replayBuf = append(r.replayBuf, entry)
		}
		r.replayMu.Unlock()
	}

	// Forward to User Room if this is a Chat Room
	// This ensures users connected to the global "user" channel receive updates
	if r.Type == RoomTypeChat && forwardToUser {
		userRoom, err := r.hub.GetOrCreateRoom(r.initiatorID, RoomTypeUser, r.initiatorID, "", "", r.timezone)
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
			// Send error frame but don't block - message was already broadcast
			r.sendErrorFrame(ErrorCodeDispatchFailed, "Failed to save AI response to database", err, frame.TraceID, map[string]interface{}{
				"operation": "dispatch_payload",
			})
		}
	}

	if frame.Operation == DoneOperation {
		// Generation complete - room can now close if no clients
		r.generationInProgress = false
		// Stop generation timer
		if r.generationTimer != nil {
			r.generationTimer.Stop()
			r.generationTimer = nil
		}
		// Touch chat activity once per generation (we only process in the matching room)
		_ = r.store.TouchChatActivity(context.Background(), r.ID, time.Now().UTC())
		r.logger.Info("generation complete")
		r.currentModelID = ""

		// Overwrite stored message with canonical full content when provided (RunCompletedEvent).
		// This fixes duplication and wrong order from chunk accumulation in DB.
		var done DonePayload
		if err := json.Unmarshal(frame.Payload, &done); err == nil && done.Content != "" && done.MessageID != uuid.Nil {
			b := r.getOrCreateBuilder(done.MessageID, r.ID)
			b.SetFinalText(done.Content)
			if err := b.Persist(context.Background(), r.store, r.initiatorID); err != nil {
				r.logger.Error("failed to persist DONE final text", zap.Error(err), zap.String("message_id", done.MessageID.String()))
			}
		}
	}
}
