package telegram

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

const (
	linkTokenPrefix = "telegram:link:"
	LinkTokenTTL    = 10 * time.Minute
)

// Service handles Telegram integration business logic.
type Service struct {
	db     *gorm.DB
	redis  *redis.Client
	logger *zap.Logger
	token  string // Bot API token
}

// NewService creates a new Telegram service.
func NewService(db *gorm.DB, redisClient *redis.Client, logger *zap.Logger, botToken string) *Service {
	return &Service{
		db:     db,
		redis:  redisClient,
		logger: logger.With(zap.String("component", "telegram_service")),
		token:  botToken,
	}
}

// BotToken returns the bot token for external use.
func (s *Service) BotToken() string {
	return s.token
}

// DB returns the database connection for external use.
func (s *Service) DB() *gorm.DB {
	return s.db
}

// LinkUser links a Telegram chat to a Genie user. Creates a Genie Chat for the Telegram conversation.
func (s *Service) LinkUser(ctx context.Context, userID uuid.UUID, telegramChatID int64, telegramUserID int64, username string, firstName string) (*storage.TelegramUser, error) {
	// Check if already linked
	var existing storage.TelegramUser
	err := s.db.WithContext(ctx).Where("telegram_chat_id = ?", telegramChatID).First(&existing).Error
	if err == nil {
		// Already linked — update user info if needed
		existing.Username = username
		existing.FirstName = firstName
		s.db.WithContext(ctx).Save(&existing)
		return &existing, nil
	}

	// Create a Genie Chat for this Telegram conversation
	chatID := uuid.New()
	title := fmt.Sprintf("Telegram: %s", firstName)
	if username != "" {
		title = fmt.Sprintf("Telegram: @%s", username)
	}

	chat := storage.Chat{
		ID:        chatID,
		UserID:    userID,
		Model:     "default",
		Title:     title,
		Mode:      "agent",
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	if err := s.db.WithContext(ctx).Create(&chat).Error; err != nil {
		return nil, fmt.Errorf("failed to create genie chat: %w", err)
	}

	// Create the mapping
	tgUser := storage.TelegramUser{
		ID:             uuid.New(),
		UserID:         userID,
		TelegramChatID: telegramChatID,
		TelegramUserID: telegramUserID,
		Username:       username,
		FirstName:      firstName,
		ChatID:         chatID,
		LinkedAt:       time.Now().UTC(),
	}
	if err := s.db.WithContext(ctx).Create(&tgUser).Error; err != nil {
		return nil, fmt.Errorf("failed to create telegram user mapping: %w", err)
	}

	s.logger.Info("linked telegram user",
		zap.String("user_id", userID.String()),
		zap.Int64("telegram_chat_id", telegramChatID),
		zap.String("chat_id", chatID.String()),
	)

	return &tgUser, nil
}

// GetByTelegramChatID looks up a TelegramUser by Telegram chat ID.
func (s *Service) GetByTelegramChatID(ctx context.Context, chatID int64) (*storage.TelegramUser, error) {
	var tgUser storage.TelegramUser
	err := s.db.WithContext(ctx).Where("telegram_chat_id = ?", chatID).First(&tgUser).Error
	if err != nil {
		return nil, err
	}
	return &tgUser, nil
}

// GetByUserID looks up a TelegramUser by Genie user ID.
func (s *Service) GetByUserID(ctx context.Context, userID uuid.UUID) (*storage.TelegramUser, error) {
	var tgUser storage.TelegramUser
	err := s.db.WithContext(ctx).Where("user_id = ?", userID).First(&tgUser).Error
	if err != nil {
		return nil, err
	}
	return &tgUser, nil
}

// GenerateLinkToken creates a temporary token for linking a Telegram account to a Genie user.
func (s *Service) GenerateLinkToken(ctx context.Context, userID uuid.UUID) (string, error) {
	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", fmt.Errorf("failed to generate token: %w", err)
	}
	token := hex.EncodeToString(tokenBytes)

	// Store in Redis with TTL
	key := linkTokenPrefix + token
	if err := s.redis.Set(ctx, key, userID.String(), LinkTokenTTL).Err(); err != nil {
		return "", fmt.Errorf("failed to store link token: %w", err)
	}

	return token, nil
}

// ValidateLinkToken validates a link token and returns the associated user ID.
func (s *Service) ValidateLinkToken(ctx context.Context, token string) (uuid.UUID, error) {
	key := linkTokenPrefix + token
	userIDStr, err := s.redis.Get(ctx, key).Result()
	if err == redis.Nil {
		return uuid.Nil, fmt.Errorf("link token expired or invalid")
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("failed to validate link token: %w", err)
	}

	// Delete the token so it can only be used once
	s.redis.Del(ctx, key)

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid user ID in token: %w", err)
	}

	return userID, nil
}

// SendMessage sends a text message to a Telegram chat.
func (s *Service) SendMessage(chatID int64, text string) error {
	return s.callAPI("sendMessage", map[string]interface{}{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "HTML",
	})
}

// SendPhoto sends a photo to a Telegram chat.
func (s *Service) SendPhoto(chatID int64, photoURL string, caption string) error {
	data := map[string]interface{}{
		"chat_id": chatID,
		"photo":   photoURL,
	}
	if caption != "" {
		data["caption"] = caption
	}
	return s.callAPI("sendPhoto", data)
}

// InlineButton represents a Telegram inline keyboard button.
type InlineButton struct {
	Text         string `json:"text"`
	CallbackData string `json:"callback_data,omitempty"`
	URL          string `json:"url,omitempty"`
}

// SendButtons sends a message with inline keyboard buttons.
func (s *Service) SendButtons(chatID int64, text string, buttons []InlineButton) error {
	var row []map[string]string
	for _, btn := range buttons {
		b := map[string]string{"text": btn.Text}
		if btn.URL != "" {
			b["url"] = btn.URL
		} else if btn.CallbackData != "" {
			b["callback_data"] = btn.CallbackData
		} else {
			b["callback_data"] = btn.Text
		}
		row = append(row, b)
	}

	replyMarkup, _ := json.Marshal(map[string]interface{}{
		"inline_keyboard": []interface{}{row},
	})

	return s.callAPI("sendMessage", map[string]interface{}{
		"chat_id":      chatID,
		"text":         text,
		"parse_mode":   "HTML",
		"reply_markup": string(replyMarkup),
	})
}

// callAPI makes a POST request to the Telegram Bot API.
func (s *Service) callAPI(method string, data map[string]interface{}) error {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/%s", s.token, method)

	body, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to call telegram API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var result map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&result)
		return fmt.Errorf("telegram API error: %d - %v", resp.StatusCode, result["description"])
	}

	return nil
}
