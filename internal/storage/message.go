package storage

import (
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
)

func (s *Storage) CreateMessage(m *chat.Message) (*chat.Message, error) {
	// Implementation for creating a message in the database
	return m, nil
}

func (s *Storage) GetMessages(chatID uuid.UUID) ([]*chat.Message, error) {
	// Implementation for getting messages from the database
	return []*chat.Message{}, nil
}
