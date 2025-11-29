package storage

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// PluginChat stores chats created by plugins (e.g., Gmail threads),
// separated from user-created chats.
type PluginChat struct {
	ID            uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID        uuid.UUID `gorm:"type:uuid;not null;index"`
	Provider      string    `gorm:"type:varchar(100);not null;index"`
	IntegrationID uuid.UUID `gorm:"type:uuid;not null;index"`
	ExternalID    string    `gorm:"type:text;not null;index"` // ID provided by plugin (e.g., thread id)
	Title         string    `gorm:"type:text;not null"`
	CreatedAt     time.Time `gorm:"not null"`
	UpdatedAt     time.Time `gorm:"not null"`
}

func (PluginChat) TableName() string {
	return "plugin_chats"
}

// PluginChatWithStats bundles chat info with last activity/volume.
type PluginChatWithStats struct {
	PluginChat
	LastReceived *time.Time
	Count        int64
	LastTitle    string
	LastSummary  string
}

func (s *Storage) FindPluginChatByExternalID(ctx context.Context, userID uuid.UUID, provider string, externalID string) (*PluginChat, error) {
	var chat PluginChat
	if err := s.DB.WithContext(ctx).
		Where("user_id = ? AND provider = ? AND external_id = ?", userID, provider, externalID).
		First(&chat).Error; err != nil {
		return nil, err
	}
	return &chat, nil
}

func (s *Storage) CreatePluginChat(ctx context.Context, chat *PluginChat) (*PluginChat, error) {
	now := time.Now()
	if chat.ID == uuid.Nil {
		chat.ID = uuid.New()
	}
	chat.CreatedAt = now
	chat.UpdatedAt = now
	if err := s.DB.WithContext(ctx).Create(chat).Error; err != nil {
		return nil, err
	}
	return chat, nil
}

func (s *Storage) GetPluginChat(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) (*PluginChat, error) {
	var chat PluginChat
	if err := s.DB.WithContext(ctx).
		Where("id = ? AND user_id = ?", chatID, userID).
		First(&chat).Error; err != nil {
		return nil, err
	}
	return &chat, nil
}

// ListPluginChatsWithStats returns chats for provider/user with counts and last received timestamp.
func (s *Storage) ListPluginChatsWithStats(ctx context.Context, userID uuid.UUID, provider string, integrationID *uuid.UUID) ([]PluginChatWithStats, error) {
	var (
		chats []PluginChat
	)

	chatWhere := []string{"user_id = ?", "provider = ?"}
	chatArgs := []interface{}{userID, provider}
	if integrationID != nil && *integrationID != uuid.Nil {
		chatWhere = append(chatWhere, "integration_id = ?")
		chatArgs = append(chatArgs, *integrationID)
	}

	if err := s.DB.WithContext(ctx).
		Where(strings.Join(chatWhere, " AND "), chatArgs...).
		Order("updated_at DESC").
		Find(&chats).Error; err != nil {
		return nil, err
	}

	// Aggregate inbox stats by chat_id stored in metadata.
	type aggRow struct {
		ChatID       string
		LastReceived *time.Time
		Count        int64
	}
	var agg []aggRow

	inboxWhere := []string{"user_id = ?", "source = ?", "metadata->>'chat_id' IS NOT NULL"}
	inboxArgs := []interface{}{userID, provider}
	if integrationID != nil && *integrationID != uuid.Nil {
		inboxWhere = append(inboxWhere, "integration_id = ?")
		inboxArgs = append(inboxArgs, *integrationID)
	}

	if err := s.DB.
		WithContext(ctx).
		Raw(`SELECT metadata->>'chat_id' AS chat_id,
				MAX(received_at) AS last_received,
				COUNT(*) AS count
			FROM inboxes
			WHERE `+strings.Join(inboxWhere, " AND ")+`
			GROUP BY metadata->>'chat_id'`, inboxArgs...).
		Scan(&agg).Error; err != nil {
		return nil, err
	}
	stats := make(map[string]aggRow, len(agg))
	for _, row := range agg {
		stats[row.ChatID] = row
	}

	// For last title/summary, fetch latest message per chat (best-effort).
	type lastMsg struct {
		ChatID  string
		Header  string
		Summary string
	}
	var lastMessages []lastMsg

	lastWhere := []string{"user_id = ?", "source = ?", "metadata->>'chat_id' IS NOT NULL"}
	lastArgs := []interface{}{userID, provider}
	if integrationID != nil && *integrationID != uuid.Nil {
		lastWhere = append(lastWhere, "integration_id = ?")
		lastArgs = append(lastArgs, *integrationID)
	}

	if err := s.DB.WithContext(ctx).
		Raw(`SELECT DISTINCT ON (metadata->>'chat_id')
				metadata->>'chat_id' AS chat_id,
				header,
				summary
			FROM inboxes
			WHERE `+strings.Join(lastWhere, " AND ")+`
			ORDER BY metadata->>'chat_id', received_at DESC`, lastArgs...).
		Scan(&lastMessages).Error; err != nil && err != gorm.ErrRecordNotFound {
		return nil, err
	}
	lastMap := make(map[string]lastMsg, len(lastMessages))
	for _, row := range lastMessages {
		lastMap[row.ChatID] = row
	}

	res := make([]PluginChatWithStats, len(chats))
	for i, chat := range chats {
		stat := stats[chat.ID.String()]
		last := lastMap[chat.ID.String()]
		res[i] = PluginChatWithStats{
			PluginChat:   chat,
			LastReceived: stat.LastReceived,
			Count:        stat.Count,
			LastTitle:    last.Header,
			LastSummary:  last.Summary,
		}
	}
	return res, nil
}
