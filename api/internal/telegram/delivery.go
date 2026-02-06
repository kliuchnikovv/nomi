package telegram

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// DeliveryService intercepts AI response frames for Telegram-linked chats
// and delivers them via Telegram Bot API.
type DeliveryService struct {
	service *Service
	redis   *redis.Client
	logger  *zap.Logger

	// Track which chat IDs are Telegram-linked for fast lookup
	mu             sync.RWMutex
	telegramChats  map[uuid.UUID]int64 // Genie chatID -> Telegram chatID
	tokenBuffers   map[uuid.UUID]*tokenBuffer // Genie chatID -> accumulated text
}

// tokenBuffer accumulates streamed tokens and flushes them as complete messages.
type tokenBuffer struct {
	text      strings.Builder
	lastFlush time.Time
	timer     *time.Timer
}

// NewDeliveryService creates a new delivery service for Telegram messages.
func NewDeliveryService(service *Service, redisClient *redis.Client, logger *zap.Logger) *DeliveryService {
	return &DeliveryService{
		service:       service,
		redis:         redisClient,
		logger:        logger.With(zap.String("component", "telegram_delivery")),
		telegramChats: make(map[uuid.UUID]int64),
		tokenBuffers:  make(map[uuid.UUID]*tokenBuffer),
	}
}

// RegisterChat registers a Genie chat ID as Telegram-linked.
func (d *DeliveryService) RegisterChat(genieChatID uuid.UUID, telegramChatID int64) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.telegramChats[genieChatID] = telegramChatID
}

// UnregisterChat removes a chat from the Telegram delivery tracking.
func (d *DeliveryService) UnregisterChat(genieChatID uuid.UUID) {
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.telegramChats, genieChatID)
	delete(d.tokenBuffers, genieChatID)
}

// IsTelegramChat checks if a Genie chat is linked to Telegram.
func (d *DeliveryService) IsTelegramChat(genieChatID uuid.UUID) bool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	_, ok := d.telegramChats[genieChatID]
	return ok
}

// GetTelegramChatID returns the Telegram chat ID for a Genie chat.
func (d *DeliveryService) GetTelegramChatID(genieChatID uuid.UUID) (int64, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	id, ok := d.telegramChats[genieChatID]
	return id, ok
}

// HandleFrame processes an outbound frame and delivers it to Telegram if applicable.
// Returns true if the frame was handled (sent to Telegram).
func (d *DeliveryService) HandleFrame(chatID uuid.UUID, frameData json.RawMessage) bool {
	tgChatID, ok := d.GetTelegramChatID(chatID)
	if !ok {
		return false
	}

	// Parse the frame
	var frame struct {
		Kind    string          `json:"kind"`
		Op      string          `json:"op"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(frameData, &frame); err != nil {
		d.logger.Warn("failed to parse frame for telegram delivery", zap.Error(err))
		return false
	}

	switch {
	case frame.Op == "message" && frame.Kind == "data":
		// Streaming text token — accumulate
		d.handleTextToken(chatID, tgChatID, frame.Payload)
		return true

	case frame.Op == "done":
		// Generation complete — flush any remaining buffer
		d.flushBuffer(chatID, tgChatID)
		// Also check for canonical content in done payload
		d.handleDonePayload(chatID, tgChatID, frame.Payload)
		return true

	default:
		return false
	}
}

// handleTextToken accumulates streamed text tokens.
func (d *DeliveryService) handleTextToken(chatID uuid.UUID, tgChatID int64, payload json.RawMessage) {
	var textPayload struct {
		Type    string `json:"type"`
		Delta   string `json:"delta"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(payload, &textPayload); err != nil {
		return
	}

	// Only handle text payloads
	if textPayload.Type != "text" && textPayload.Type != "" {
		return
	}

	text := textPayload.Delta
	if text == "" {
		text = textPayload.Message
	}
	if text == "" {
		return
	}

	d.mu.Lock()
	buf, ok := d.tokenBuffers[chatID]
	if !ok {
		buf = &tokenBuffer{lastFlush: time.Now()}
		d.tokenBuffers[chatID] = buf
	}
	buf.text.WriteString(text)

	// Set up a flush timer if not already set
	if buf.timer != nil {
		buf.timer.Stop()
	}
	buf.timer = time.AfterFunc(2*time.Second, func() {
		d.flushBuffer(chatID, tgChatID)
	})
	d.mu.Unlock()
}

// handleDonePayload checks the done frame for canonical content.
func (d *DeliveryService) handleDonePayload(chatID uuid.UUID, tgChatID int64, payload json.RawMessage) {
	var donePayload struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal(payload, &donePayload); err != nil || donePayload.Content == "" {
		return
	}

	// If we have canonical content from done, use it instead of the buffered tokens.
	// Clear the buffer first.
	d.mu.Lock()
	if buf, ok := d.tokenBuffers[chatID]; ok {
		if buf.timer != nil {
			buf.timer.Stop()
		}
		delete(d.tokenBuffers, chatID)
	}
	d.mu.Unlock()

	// Send the canonical content
	if err := d.service.SendMessage(tgChatID, donePayload.Content); err != nil {
		d.logger.Error("failed to send done content to telegram",
			zap.Error(err),
			zap.Int64("telegram_chat_id", tgChatID),
		)
	}
}

// flushBuffer sends accumulated text to Telegram.
func (d *DeliveryService) flushBuffer(chatID uuid.UUID, tgChatID int64) {
	d.mu.Lock()
	buf, ok := d.tokenBuffers[chatID]
	if !ok || buf.text.Len() == 0 {
		d.mu.Unlock()
		return
	}
	text := buf.text.String()
	buf.text.Reset()
	buf.lastFlush = time.Now()
	if buf.timer != nil {
		buf.timer.Stop()
		buf.timer = nil
	}
	d.mu.Unlock()

	if err := d.service.SendMessage(tgChatID, text); err != nil {
		d.logger.Error("failed to send buffered text to telegram",
			zap.Error(err),
			zap.Int64("telegram_chat_id", tgChatID),
		)
	}
}

// LoadTelegramChats loads all Telegram chat mappings from DB into memory.
func (d *DeliveryService) LoadTelegramChats(ctx context.Context) error {
	var users []storage.TelegramUser
	if err := d.service.DB().WithContext(ctx).Find(&users).Error; err != nil {
		return fmt.Errorf("failed to load telegram users: %w", err)
	}

	d.mu.Lock()
	defer d.mu.Unlock()
	for _, u := range users {
		d.telegramChats[u.ChatID] = u.TelegramChatID
	}

	d.logger.Info("loaded telegram chat mappings", zap.Int("count", len(users)))
	return nil
}
