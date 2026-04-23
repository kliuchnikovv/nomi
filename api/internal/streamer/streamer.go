package streamer

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// Helper to convert string to *string
func stringPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

type Streamer struct {
	storage *storage.Storage
	logger  *zap.Logger
	redis   *redis.Client

	userID uuid.UUID
	// chatID uuid.UUID

	source             string
	initialMessage     string
	initialAttachments []chat.Attachment
	commandPayload     chat.Command
	chatHistory        []*chat.Message
	historyChatID      *uuid.UUID
}

func New(
	storage *storage.Storage,
	logger *zap.Logger,
	redis *redis.Client,
	userID uuid.UUID,
	initialMessage string,
	initialAttachments []chat.Attachment,
	source string,
	commandPayload chat.Command,
	chatHistory []*chat.Message,
	historyChatID *uuid.UUID,
) *Streamer {
	return &Streamer{
		storage:            storage,
		logger:             logger,
		redis:              redis,
		userID:             userID,
		initialMessage:     initialMessage,
		initialAttachments: initialAttachments,
		source:             source,
		commandPayload:     commandPayload,
		chatHistory:        chatHistory,
		historyChatID:      historyChatID,
	}
}

func (streamer *Streamer) Stream(client *Socket) {
	var ctx, cancel = context.WithCancel(context.Background())
	defer cancel()

	// Resolve chatID once
	resolveChatID := func() uuid.UUID {
		if streamer.historyChatID != nil {
			return *streamer.historyChatID
		}
		if len(streamer.chatHistory) > 0 {
			return streamer.chatHistory[0].ChatID
		}
		return uuid.Nil
	}
	chatID := resolveChatID()

	// 1. Subscribe to Redis for responses (chat:user:<UserID>)
	// Note: We subscribe to the User's channel, not Chat channel, because responses are targeted to user.
	// We will filter by ChatID if needed, but currently Python publishes to chat:user:<UserID>.
	userChannel := fmt.Sprintf("chat:user:%s", streamer.userID.String())
	sub := streamer.redis.Subscribe(ctx, userChannel)
	defer sub.Close()

	streamer.logger.Info("subscribed to redis channel", zap.String("channel", userChannel))

	// Channel for incoming Redis messages
	redisCh := sub.Channel()

	// Channel for client messages
	clientFrames, clientErrs := client.Read(ctx)

	// Send initial message if present
	if streamer.initialMessage != "" {
		// Prepare history data
		var historyData []map[string]interface{}
		if len(streamer.chatHistory) > 0 {
			historyData = make([]map[string]interface{}, 0, len(streamer.chatHistory))
			for _, msg := range streamer.chatHistory {
				historyData = append(historyData, map[string]interface{}{
					"role":    string(msg.Role),
					"content": msg.Text,
				})
			}
		}

		// Bundle Tools
		var tools []interface{}
		tools = append(tools, map[string]interface{}{"name": "web_search", "enabled": true})
		tools = append(tools, map[string]interface{}{"name": "knowledge_search", "enabled": true, "user_id": streamer.userID.String()})

		integrations := []storage.Integration{}
		if err := streamer.storage.DB.WithContext(ctx).Where("user_id = ? AND enabled = ?", streamer.userID, true).Find(&integrations).Error; err == nil {
			for _, integ := range integrations {
				// Parse Params
				var paramsMap map[string]interface{}
				if err := json.Unmarshal([]byte(integ.Params), &paramsMap); err != nil {
					paramsMap = make(map[string]interface{})
				}
				paramsMap["name"] = integ.Provider
				paramsMap["enabled"] = true
				tools = append(tools, paramsMap)
			}
		} else {
			streamer.logger.Warn("failed to fetch user integrations for bundling", zap.Error(err))
		}

		msgFrame := Frame{
			Kind:      TokenKind,
			Operation: MessageOperation,
			Timestamp: time.Now().UTC(),
			ChatID:    chatID,
			Payload: Payload{
				Message:     streamer.initialMessage,
				Attachments: streamer.initialAttachments,
				History:     historyData,
				Tools:       tools,
				Command:     streamer.commandPayload,
				UserID:      streamer.userID,
			},
		}

		// Publish initial message to Redis
		payloadBytes, err := json.Marshal(msgFrame)
		if err != nil {
			streamer.logger.Error("failed to marshal initial message", zap.Error(err))
		} else {
			requestChannel := fmt.Sprintf("chat:request:%s", chatID.String())
			if err := streamer.redis.Publish(ctx, requestChannel, payloadBytes).Err(); err != nil {
				streamer.logger.Error("failed to publish initial message to redis", zap.Error(err))
			} else {
				streamer.logger.Info("published initial message to redis",
					zap.String("channel", requestChannel),
					zap.String("message", streamer.initialMessage))
			}
		}
	}

	// Idle timeout
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

	// Track metadata struct
	type MessageMetadata struct {
		MessageID uuid.UUID
		Model     string
		ToolCalls []chat.ToolCall
	}
	var currentMessageMetadata MessageMetadata

	for {
		select {
		case <-ctx.Done():
			streamer.logger.Debug("context is done")
			return
		case <-timer.C:
			streamer.logger.Info("idle timeout reached; terminating stream")
			return

		// --- Redis Messages (From Python) ---
		case msg, ok := <-redisCh:
			if !ok {
				streamer.logger.Error("redis channel closed")
				return
			}
			resetTimer()

			var frame Frame
			if err := json.Unmarshal([]byte(msg.Payload), &frame); err != nil {
				streamer.logger.Warn("failed to unmarshal redis message", zap.Error(err))
				continue
			}

			if frame.ChatID != uuid.Nil && chatID != uuid.Nil && frame.ChatID != chatID {
				continue
			}

			// Handle Metadata
			if frame.Operation == MessageOperation && frame.Kind == MetaKind && frame.Payload.Type == "metadata" {
				currentMessageMetadata.MessageID = frame.Payload.MessageID
				if frame.Payload.Model != "" {
					currentMessageMetadata.Model = frame.Payload.Model
				}
				if frame.Payload.ToolCalls != nil {
					currentMessageMetadata.ToolCalls = frame.Payload.ToolCalls
				}
				if currentMessageMetadata.MessageID != uuid.Nil {
					_ = streamer.storage.UpsertMessage(ctx, streamer.userID, &chat.Message{
						ID:        currentMessageMetadata.MessageID,
						ChatID:    frame.ChatID,
						Sender:    storage.ZeroUUID,
						Role:      chat.RoleAssistant,
						Model:     currentMessageMetadata.Model,
						AgentID:   stringPtr(frame.Payload.AgentName),
						ToolCalls: currentMessageMetadata.ToolCalls,
						CreatedAt: time.Now().UTC(),
					})
				}
			}

			// Handle Token/Message
			if frame.Operation == MessageOperation && frame.Kind == TokenKind {
				if currentMessageMetadata.MessageID == uuid.Nil {
					currentMessageMetadata.MessageID = frame.Payload.MessageID
				}
				_ = streamer.storage.UpsertMessage(ctx, streamer.userID, &chat.Message{
					ID:        frame.Payload.MessageID,
					ChatID:    frame.ChatID,
					Sender:    storage.ZeroUUID,
					Role:      chat.RoleAssistant,
					Text:      frame.Payload.Message,
					Model:     currentMessageMetadata.Model,
					AgentID:   stringPtr(frame.Payload.AgentName),
					ToolCalls: currentMessageMetadata.ToolCalls,
					CreatedAt: time.Now().UTC(),
				})
				_ = streamer.storage.TouchChatActivity(ctx, frame.ChatID, time.Now().UTC())
			}

			// Reset metadata
			if frame.Operation == DoneOperation {
				currentMessageMetadata = MessageMetadata{}
			}

			// Forward to Client
			if err := client.Write(ctx, frame); err != nil {
				streamer.logger.Error("failed to write to client", zap.Error(err))
				return
			}

		// --- Client Messages (From WebSocket) ---
		case frame, ok := <-clientFrames:
			if !ok {
				streamer.logger.Info("client closed connection")
				return
			}
			resetTimer()

			// Upsert User Message
			if frame.Operation == MessageOperation && frame.Payload.MessageID == storage.ZeroUUID {
				now := time.Now().UTC()
				msgID := uuid.New()
				_ = streamer.storage.UpsertMessage(ctx, streamer.userID, &chat.Message{
					ID:        msgID,
					ChatID:    frame.ChatID,
					Sender:    streamer.userID,
					Role:      chat.RoleUser,
					Text:      frame.Payload.Message,
					Model:     frame.Payload.Model,
					CreatedAt: now,
				})
				// A user message via WebSocket is also considered
				// meaningful chat activity.
				_ = streamer.storage.TouchChatActivity(ctx, frame.ChatID, now)
			}

			// Enrich with Attachments
			if frame.Operation == MessageOperation && len(frame.Payload.AttachmentIDs) > 0 {
				atts, err := streamer.storage.GetAttachmentsByIDs(ctx, frame.Payload.AttachmentIDs)
				if err == nil {
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

			// Enrich with History & Tools
			messages, err := streamer.storage.GetMessages(ctx, streamer.userID, frame.ChatID, 50)
			if err == nil && len(messages) > 0 {
				historyData := make([]map[string]interface{}, 0, len(messages))
				for _, msg := range messages {
					historyData = append(historyData, map[string]interface{}{
						"role":    string(msg.Role),
						"content": msg.Text,
					})
				}
				frame.Payload.History = historyData
			}
			var tools []interface{}
			tools = append(tools, map[string]interface{}{"name": "web_search", "enabled": true})
			tools = append(tools, map[string]interface{}{"name": "knowledge_search", "enabled": true, "user_id": streamer.userID.String()})
			integrations := []storage.Integration{}
			if err := streamer.storage.DB.WithContext(ctx).Where("user_id = ? AND enabled = ?", streamer.userID, true).Find(&integrations).Error; err == nil {
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
			frame.Payload.Tools = tools
			frame.Payload.UserID = streamer.userID

			// Publish to Redis
			payloadBytes, err := json.Marshal(frame)
			if err != nil {
				streamer.logger.Error("failed to marshal client frame", zap.Error(err))
				continue
			}
			requestChannel := fmt.Sprintf("chat:request:%s", frame.ChatID.String())
			if err := streamer.redis.Publish(ctx, requestChannel, payloadBytes).Err(); err != nil {
				streamer.logger.Error("failed to publish to redis", zap.Error(err))
			} else {
				streamer.logger.Info("forwarded client message to redis", zap.String("channel", requestChannel))
			}

		case err, ok := <-clientErrs:
			if !ok {
				return
			}
			streamer.logger.Error("client error", zap.Error(err))
			return
		}
	}
}
