package services

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"gorm.io/gorm"
)

// mockChatRepository is a mock repository for testing
type mockChatRepository struct {
	chats map[uuid.UUID]*chat.Chat
}

func newMockChatRepository() *mockChatRepository {
	return &mockChatRepository{
		chats: make(map[uuid.UUID]*chat.Chat),
	}
}

func (m *mockChatRepository) Create(ctx context.Context, userID uuid.UUID, c *chat.Chat) (*chat.Chat, error) {
	m.chats[c.ID] = c
	return c, nil
}

func (m *mockChatRepository) Get(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) (*chat.Chat, error) {
	if c, ok := m.chats[chatID]; ok {
		return c, nil
	}
	return nil, gorm.ErrRecordNotFound
}

func (m *mockChatRepository) List(ctx context.Context, userID uuid.UUID) ([]*chat.Chat, error) {
	result := make([]*chat.Chat, 0, len(m.chats))
	for _, c := range m.chats {
		result = append(result, c)
	}
	return result, nil
}

func (m *mockChatRepository) Update(ctx context.Context, userID uuid.UUID, c *chat.Chat) (*chat.Chat, error) {
	if _, ok := m.chats[c.ID]; !ok {
		return nil, gorm.ErrRecordNotFound
	}
	m.chats[c.ID] = c
	return c, nil
}

func (m *mockChatRepository) Delete(ctx context.Context, userID uuid.UUID, chatID uuid.UUID) error {
	if _, ok := m.chats[chatID]; !ok {
		return gorm.ErrRecordNotFound
	}
	delete(m.chats, chatID)
	return nil
}

func (m *mockChatRepository) GetUserChatsModifiedAfter(ctx context.Context, userID uuid.UUID, since time.Time) ([]*chat.Chat, error) {
	result := make([]*chat.Chat, 0)
	for _, c := range m.chats {
		if c.UpdatedAt.After(since) {
			result = append(result, c)
		}
	}
	return result, nil
}

func (m *mockChatRepository) GetOrCreatePersistent(ctx context.Context, userID uuid.UUID, defaultModel string) (*chat.Chat, error) {
	for _, c := range m.chats {
		if c.Type == "persistent" {
			return c, nil
		}
	}
	c := &chat.Chat{
		ID:    uuid.New(),
		Model: defaultModel,
		Title: "Genie",
		Mode:  "agent",
		Type:  "persistent",
	}
	m.chats[c.ID] = c
	return c, nil
}

func (m *mockChatRepository) ArchiveMessages(ctx context.Context, userID uuid.UUID, chatID uuid.UUID, messageIDs []uuid.UUID) error {
	return nil
}

func TestChatService_CreateChat(t *testing.T) {
	repo := newMockChatRepository()
	service := NewChatService(repo)

	ctx := context.Background()
	userID := uuid.New()

	req := &CreateChatRequest{
		Model: "gemini-2.0-flash",
		Title: "Test Chat",
		Mode:  "agent",
	}

	created, err := service.CreateChat(ctx, userID, req)
	if err != nil {
		t.Fatalf("CreateChat failed: %v", err)
	}

	if created.Title != "Test Chat" {
		t.Errorf("Expected title 'Test Chat', got '%s'", created.Title)
	}

	if created.Mode != "agent" {
		t.Errorf("Expected mode 'agent', got '%s'", created.Mode)
	}

	if created.Icon != "" {
		t.Errorf("Expected empty icon for agent mode, got '%s'", created.Icon)
	}
}

func TestChatService_GetIconForTeam(t *testing.T) {
	repo := newMockChatRepository()
	service := NewChatService(repo)

	tests := []struct {
		teamID *string
		want   string
	}{
		{nil, ""},
		{strPtr("dnd_team"), "d20"},
		{strPtr("genie"), "sparkles"},
		{strPtr("development_team"), "code"},
		{strPtr("unknown"), ""},
	}

	for _, tt := range tests {
		got := service.GetIconForTeam(tt.teamID)
		if got != tt.want {
			t.Errorf("GetIconForTeam(%v) = %v, want %v", tt.teamID, got, tt.want)
		}
	}
}

func strPtr(s string) *string {
	return &s
}
