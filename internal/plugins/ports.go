package plugins

import (
	"context"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/llm"
	"github.com/kliuchnikovv/genie-api/internal/notifier"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// StorageAdapter bridges the core storage implementation to plugin-facing interfaces.
type StorageAdapter struct {
	store *storage.Storage
}

func NewStorageAdapter(store *storage.Storage) *StorageAdapter {
	return &StorageAdapter{store: store}
}

func (s *StorageAdapter) GetIntegrations(ctx context.Context, userID uuid.UUID) ([]storage.Integration, error) {
	return s.store.GetIntegrations(ctx, userID)
}

func (s *StorageAdapter) GetIntegrationsByProvider(ctx context.Context, provider string) ([]storage.Integration, error) {
	return s.store.GetIntegrationsByProvider(ctx, provider)
}

func (s *StorageAdapter) GetOAuthTokenByUser(ctx context.Context, userID uuid.UUID, provider string) (*storage.OAuthToken, error) {
	return s.store.GetOAuthTokenByUser(ctx, userID, provider)
}

func (s *StorageAdapter) UpdateOAuthToken(ctx context.Context, token *storage.OAuthToken) error {
	return s.store.UpdateOAuthToken(ctx, token)
}

func (s *StorageAdapter) InboxExistsByMessageID(ctx context.Context, userID uuid.UUID, messageID string) (bool, error) {
	var count int64
	err := s.store.DB.WithContext(ctx).
		Model(&storage.Inbox{}).
		Where("user_id = ? AND message_id = ?", userID, messageID).
		Count(&count).Error
	return count > 0, err
}

func (s *StorageAdapter) CreateInbox(ctx context.Context, inbox *storage.Inbox) error {
	return s.store.DB.WithContext(ctx).Create(inbox).Error
}

func (s *StorageAdapter) UpdateInbox(ctx context.Context, inbox *storage.Inbox) error {
	return s.store.DB.WithContext(ctx).Save(inbox).Error
}

// LLMAdapter exposes only the surface plugins need.
type LLMAdapter struct {
	svc *llm.Service
}

func NewLLMAdapter(svc *llm.Service) *LLMAdapter {
	return &LLMAdapter{svc: svc}
}

func (l *LLMAdapter) GenerateSimple(ctx context.Context, userID uuid.UUID, prompt string, agent string) (string, error) {
	return l.svc.GenerateSimple(ctx, userID, prompt, agent)
}

// NotifierAdapter hides the concrete notifier behind an interface.
type NotifierAdapter struct {
	n *notifier.Notifier
}

func NewNotifierAdapter(n *notifier.Notifier) *NotifierAdapter {
	return &NotifierAdapter{n: n}
}

func (n *NotifierAdapter) Publish(chatID uuid.UUID, ev notifier.Event) {
	n.n.Publish(chatID, ev)
}
