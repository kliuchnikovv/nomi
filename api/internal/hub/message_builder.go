package hub

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

// MessageBuilder handles state accumulation for a single message
type MessageBuilder struct {
	ID           uuid.UUID
	ChatID       uuid.UUID
	Role         chat.Role
	Model        string
	Text         string
	Reasoning    string
	ToolCalls    []interface{}
	ContentParts []interface{}
	Actions      interface{}
	logger       *zap.Logger
}

func NewMessageBuilder(id, chatID uuid.UUID, logger *zap.Logger) *MessageBuilder {
	return &MessageBuilder{
		ID:     id,
		ChatID: chatID,
		Role:   chat.RoleAssistant,
		logger: logger,
	}
}

func (b *MessageBuilder) AppendText(delta string) {
	b.Text += delta
	b.appendContentPart("text", delta)
}

func (b *MessageBuilder) AppendReasoning(delta string) {
	b.Reasoning += delta
	b.appendContentPart("reasoning", delta)
}

func (b *MessageBuilder) AppendMemberResponse(agentName, delta string) {
	b.Text += delta
	b.appendMemberContentPart(agentName, delta)
}

func (b *MessageBuilder) AddToolCall(toolCall interface{}) {
	b.ToolCalls = append(b.ToolCalls, toolCall)
	b.ContentParts = append(b.ContentParts, map[string]interface{}{
		"type":      "tool_call",
		"tool_call": toolCall,
	})
}

func (b *MessageBuilder) SetMetadata(model string, toolCalls interface{}, actions interface{}) {
	if model != "" {
		b.Model = model
	}
	if toolCalls != nil {
		// Replace or append? Usually metadata comes first or as a snapshot.
		// If it's a slice, we might want to use it.
		if tcs, ok := toolCalls.([]interface{}); ok {
			b.ToolCalls = tcs
		} else {
			// If it's single item or other structure
			// For now, let's assume it replaces if provided
			// b.ToolCalls = ...
		}
	}
	if actions != nil {
		b.Actions = actions
	}
}

func (b *MessageBuilder) appendContentPart(partType, delta string) {
	if len(b.ContentParts) > 0 {
		lastIdx := len(b.ContentParts) - 1
		if lastPart, ok := b.ContentParts[lastIdx].(map[string]interface{}); ok {
			if lastPart["type"] == partType {
				field := "text"
				if partType == "reasoning" {
					field = "reasoning"
				}
				if val, ok := lastPart[field].(string); ok {
					lastPart[field] = val + delta
					b.ContentParts[lastIdx] = lastPart
					return
				}
			}
		}
	}
	// New part
	field := "text"
	if partType == "reasoning" {
		field = "reasoning"
	}
	b.ContentParts = append(b.ContentParts, map[string]interface{}{
		"type": partType,
		field:  delta,
	})
}

func (b *MessageBuilder) appendMemberContentPart(agentName, delta string) {
	if len(b.ContentParts) > 0 {
		lastIdx := len(b.ContentParts) - 1
		if lastPart, ok := b.ContentParts[lastIdx].(map[string]interface{}); ok {
			if lastPart["type"] == "member_response" && lastPart["agent_name"] == agentName {
				if val, ok := lastPart["text"].(string); ok {
					lastPart["text"] = val + delta
					b.ContentParts[lastIdx] = lastPart
					return
				}
			}
		}
	}
	b.ContentParts = append(b.ContentParts, map[string]interface{}{
		"type":       "member_response",
		"agent_name": agentName,
		"text":       delta,
	})
}

func (b *MessageBuilder) Persist(ctx context.Context, store *storage.Storage, userID uuid.UUID) error {
	return store.UpsertMessage(ctx, userID, &chat.Message{
		ID:           b.ID,
		ChatID:       b.ChatID,
		Sender:       storage.ZeroUUID, // Assistant
		Role:         b.Role,
		Text:         b.Text,
		Reasoning:    b.Reasoning,
		Model:        b.Model,
		ToolCalls:    b.ToolCalls,
		ContentParts: b.ContentParts,
		Actions:      b.Actions,
		CreatedAt:    time.Now().UTC(),
	})
}
