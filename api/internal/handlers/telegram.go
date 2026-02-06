package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/hub"
	"github.com/kliuchnikovv/genie-api/internal/telegram"
	"go.uber.org/zap"
)

// TelegramHandler handles Telegram webhook events.
type TelegramHandler struct {
	service  *telegram.Service
	delivery *telegram.DeliveryService
	hub      *hub.Hub
	logger   *zap.Logger
}

// NewTelegramHandler creates a new Telegram handler.
func NewTelegramHandler(
	service *telegram.Service,
	delivery *telegram.DeliveryService,
	hub *hub.Hub,
	logger *zap.Logger,
) *TelegramHandler {
	return &TelegramHandler{
		service:  service,
		delivery: delivery,
		hub:      hub,
		logger:   logger.With(zap.String("component", "telegram_handler")),
	}
}

// HandleWebhook handles incoming Telegram webhook updates.
func (h *TelegramHandler) HandleWebhook(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read body"})
		return
	}

	var update telegram.TelegramUpdate
	if err := json.Unmarshal(body, &update); err != nil {
		h.logger.Warn("failed to parse telegram update", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid update"})
		return
	}

	// Always return 200 OK quickly to Telegram
	c.JSON(http.StatusOK, gin.H{"ok": true})

	// Process asynchronously
	go h.processUpdate(update)
}

func (h *TelegramHandler) processUpdate(update telegram.TelegramUpdate) {
	ctx := context.Background()

	// Handle callback queries (inline button presses)
	if update.CallbackQuery != nil {
		h.handleCallbackQuery(ctx, update.CallbackQuery)
		return
	}

	// Handle regular messages
	if update.Message == nil {
		return
	}

	msg := update.Message
	chatID := msg.Chat.ID
	text := msg.Text

	// Handle /start command for account linking
	if strings.HasPrefix(text, "/start") {
		h.handleStartCommand(ctx, chatID, msg, text)
		return
	}

	// Regular message — forward to AI
	h.handleRegularMessage(ctx, chatID, msg)
}

func (h *TelegramHandler) handleStartCommand(ctx context.Context, telegramChatID int64, msg *telegram.TelegramMessage, text string) {
	parts := strings.Fields(text)

	if len(parts) < 2 {
		// No token — send instructions
		_ = h.service.SendMessage(telegramChatID, "Welcome to Genie Bot! 🧞\n\nTo link your account, use the link from the Genie app settings.\n\nFormat: /start <link_token>")
		return
	}

	token := parts[1]

	// Validate the link token
	userID, err := h.service.ValidateLinkToken(ctx, token)
	if err != nil {
		h.logger.Warn("invalid link token", zap.Error(err), zap.String("token", token))
		_ = h.service.SendMessage(telegramChatID, "Invalid or expired link token. Please generate a new one from the Genie app.")
		return
	}

	// Get Telegram user info
	var username, firstName string
	var telegramUserID int64
	if msg.From != nil {
		username = msg.From.Username
		firstName = msg.From.FirstName
		telegramUserID = msg.From.ID
	}

	// Link the user
	tgUser, err := h.service.LinkUser(ctx, userID, telegramChatID, telegramUserID, username, firstName)
	if err != nil {
		h.logger.Error("failed to link telegram user", zap.Error(err))
		_ = h.service.SendMessage(telegramChatID, "Failed to link your account. Please try again.")
		return
	}

	// Register the chat for delivery
	h.delivery.RegisterChat(tgUser.ChatID, telegramChatID)

	_ = h.service.SendMessage(telegramChatID, "Account linked successfully! 🎉\n\nYou can now send messages here and I'll respond with AI-powered answers.")

	h.logger.Info("telegram user linked",
		zap.String("user_id", userID.String()),
		zap.Int64("telegram_chat_id", telegramChatID),
	)
}

func (h *TelegramHandler) handleRegularMessage(ctx context.Context, telegramChatID int64, msg *telegram.TelegramMessage) {
	// Look up the linked user
	tgUser, err := h.service.GetByTelegramChatID(ctx, telegramChatID)
	if err != nil {
		h.logger.Warn("unlinked telegram user sent message", zap.Int64("chat_id", telegramChatID))
		_ = h.service.SendMessage(telegramChatID, "Your account is not linked. Use /start <token> to link your Genie account.")
		return
	}

	text := msg.Text
	if text == "" {
		// Handle photo or other media — extract caption or skip
		if msg.Photo != nil && len(msg.Photo) > 0 {
			text = "[Photo received]"
		} else {
			return
		}
	}

	// Ensure the delivery service knows about this chat
	h.delivery.RegisterChat(tgUser.ChatID, telegramChatID)

	// Build the frame payload to inject into the Room
	messageID := uuid.New()
	payload := map[string]interface{}{
		"message_id": messageID.String(),
		"message":    text,
		"role":       "user",
		"model":      "default",
		"trace_id":   uuid.New().String(),
	}
	payloadBytes, _ := json.Marshal(payload)

	frame := hub.Frame{
		ID:        0,
		ChatID:    tgUser.ChatID,
		Kind:      hub.TokenKind,
		Operation: hub.MessageOperation,
		Timestamp: time.Now().UTC(),
		Payload:   payloadBytes,
	}
	frameBytes, _ := json.Marshal(frame)

	// Get or create the room and inject the message
	room, err := h.hub.GetOrCreateRoom(tgUser.ChatID, hub.RoomTypeChat, tgUser.UserID, "agent", "")
	if err != nil {
		h.logger.Error("failed to get/create room for telegram message", zap.Error(err))
		_ = h.service.SendMessage(telegramChatID, "Internal error. Please try again later.")
		return
	}

	room.InjectMessage(tgUser.UserID, frameBytes)

	h.logger.Info("injected telegram message into room",
		zap.String("chat_id", tgUser.ChatID.String()),
		zap.String("user_id", tgUser.UserID.String()),
	)
}

func (h *TelegramHandler) handleCallbackQuery(ctx context.Context, query *telegram.CallbackQuery) {
	if query.Message == nil {
		return
	}

	chatID := query.Message.Chat.ID
	data := query.Data

	h.logger.Info("received callback query",
		zap.Int64("chat_id", chatID),
		zap.String("data", data),
	)

	// Forward the callback data as a regular message
	h.handleRegularMessage(ctx, chatID, &telegram.TelegramMessage{
		From: &telegram.TelegramFrom{
			ID:        query.From.ID,
			FirstName: query.From.FirstName,
			Username:  query.From.Username,
		},
		Chat: telegram.TelegramChat{ID: chatID},
		Text: data,
	})
}

// GenerateLinkToken creates a link token for the authenticated user (API endpoint).
func (h *TelegramHandler) GenerateLinkToken(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, ok := userIDVal.(uuid.UUID)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user"})
		return
	}

	token, err := h.service.GenerateLinkToken(c.Request.Context(), userID)
	if err != nil {
		h.logger.Error("failed to generate link token", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":    token,
		"bot_link": fmt.Sprintf("https://t.me/genie_bot?start=%s", token),
	})
}
