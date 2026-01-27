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
	ToolCalls    []chat.ToolCall
	ContentParts []chat.ContentPart
	Actions      []chat.Action
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

func (b *MessageBuilder) AddToolCall(toolCall chat.ToolCall) {
	// Try to identify by ID to update existing tool call instead of appending
	toolID := toolCall.ID
	toolName := toolCall.Name

	if toolID != "" {
		// 1. Update in ToolCalls slice
		found := false
		for i, existing := range b.ToolCalls {
			if existing.ID == toolID {
				// Merge/Replace
				// We assume the new event contains the latest state.
				// If arguments are being streamed, we might need to merge them.
				// But typically arguments come in one go or we get full object updates.
				// If it's a "running" -> "completed" update, we replace.

				// Merging logic:
				// If existing has args and new one has empty args but result, keep args?
				// For now, let's assume full replacement or strict fields update.
				// The Python backend sends "tool" object constructed from event.

				// Keep existing fields if new ones are empty?
				if toolCall.Arguments == nil && existing.Arguments != nil {
					toolCall.Arguments = existing.Arguments
				}
				if toolCall.Name == "" && existing.Name != "" {
					toolCall.Name = existing.Name
				}

				b.ToolCalls[i] = toolCall
				found = true
				break
			}
		}
		if !found {
			b.ToolCalls = append(b.ToolCalls, toolCall)
		}

		// 2. Update in ContentParts
		foundPart := false
		for i, part := range b.ContentParts {
			if part.Type == "tool_call" && part.ToolCall != nil {
				if part.ToolCall.ID == toolID {
					// We need to update the pointer or the struct inside content part
					// Since ContentPart holds a pointer to ToolCall, we can just replace it
					// or update the object it points to.
					// Let's replace the pointer with a new one or update the existing one.
					// Ideally we want consistency with b.ToolCalls.

					// To ensure consistency, maybe ContentPart should reference the same object?
					// But we are dealing with structs/copies in the slice unless we use pointers in slice.
					// b.ToolCalls is []chat.ToolCall (structs).

					// Let's just update the part.
					part.ToolCall = &toolCall
					b.ContentParts[i] = part
					foundPart = true
					break
				}
			}
		}
		if !foundPart {
			b.ContentParts = append(b.ContentParts, chat.ContentPart{
				Type:     "tool_call",
				ToolCall: &toolCall,
			})
		}
	} else if toolName != "" {
		// Fallback: Try to match by name if ID is missing
		// 1. Update in ToolCalls slice
		found := false
		for i, existing := range b.ToolCalls {
			if existing.Name == toolName {
				// Check if existing is pending
				if existing.Result == nil && existing.Status != "completed" {
					// Merge
					if toolCall.ID == "" {
						toolCall.ID = existing.ID // Keep ID if we have one?
					}
					if toolCall.Arguments == nil && existing.Arguments != nil {
						toolCall.Arguments = existing.Arguments
					}
					b.ToolCalls[i] = toolCall
					found = true
					break
				}
			}
		}
		if !found {
			b.ToolCalls = append(b.ToolCalls, toolCall)
		}

		// 2. Update in ContentParts
		foundPart := false
		for i, part := range b.ContentParts {
			if part.Type == "tool_call" && part.ToolCall != nil {
				if part.ToolCall.Name == toolName {
					if part.ToolCall.Result == nil && part.ToolCall.Status != "completed" {
						part.ToolCall = &toolCall
						b.ContentParts[i] = part
						foundPart = true
						break
					}
				}
			}
		}
		if !foundPart {
			b.ContentParts = append(b.ContentParts, chat.ContentPart{
				Type:     "tool_call",
				ToolCall: &toolCall,
			})
		}
	} else {
		// Fallback: Always append
		b.ToolCalls = append(b.ToolCalls, toolCall)
		b.ContentParts = append(b.ContentParts, chat.ContentPart{
			Type:     "tool_call",
			ToolCall: &toolCall,
		})
	}
}

func (b *MessageBuilder) SetModel(model string) {
	if model != "" {
		b.Model = model
	}
}

func (b *MessageBuilder) SetToolCalls(toolCalls []chat.ToolCall) {
	if toolCalls != nil {
		b.ToolCalls = toolCalls
	}
}

func (b *MessageBuilder) SetActions(actions []chat.Action) {
	if actions != nil {
		b.Actions = actions
	}
}

func (b *MessageBuilder) appendContentPart(partType, delta string) {
	if len(b.ContentParts) > 0 {
		lastIdx := len(b.ContentParts) - 1
		lastPart := b.ContentParts[lastIdx]

		if lastPart.Type == partType {
			if partType == "reasoning" {
				lastPart.Reasoning += delta
			} else {
				lastPart.Text += delta
			}
			b.ContentParts[lastIdx] = lastPart
			return
		}
	}
	// New part
	part := chat.ContentPart{
		Type: partType,
	}
	if partType == "reasoning" {
		part.Reasoning = delta
	} else {
		part.Text = delta
	}
	b.ContentParts = append(b.ContentParts, part)
}

func (b *MessageBuilder) appendMemberContentPart(agentName, delta string) {
	if len(b.ContentParts) > 0 {
		lastIdx := len(b.ContentParts) - 1
		lastPart := b.ContentParts[lastIdx]

		if lastPart.Type == "member_response" && lastPart.AgentName == agentName {
			lastPart.Text += delta
			b.ContentParts[lastIdx] = lastPart
			return
		}
	}
	b.ContentParts = append(b.ContentParts, chat.ContentPart{
		Type:      "member_response",
		AgentName: agentName,
		Text:      delta,
	})
}

func (b *MessageBuilder) Persist(ctx context.Context, store *storage.Storage, userID uuid.UUID) error {
	// We need to convert types to interface{} to satisfy chat.Message struct
	// if it still uses interface{}.
	// But we updated chat.Message to use []ToolCall etc.

	// However, api/internal/storage/models.go still uses datatypes.JSON
	// So store.UpsertMessage (which likely maps chat.Message to storage.Message)
	// needs to handle the conversion.
	// Let's verify storage.UpsertMessage first.

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
