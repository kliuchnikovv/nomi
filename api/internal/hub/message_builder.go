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
	// Try to identify by ID to update existing tool call instead of appending
	var toolID string
	if tcMap, ok := toolCall.(map[string]interface{}); ok {
		if id, ok := tcMap["id"].(string); ok {
			toolID = id
		}
	}

	// Helper to extract name
	var toolName string
	if tcMap, ok := toolCall.(map[string]interface{}); ok {
		if name, ok := tcMap["name"].(string); ok {
			toolName = name
		}
	}

	if toolID != "" {
		// 1. Update in ToolCalls slice
		found := false
		for i, existing := range b.ToolCalls {
			if existingMap, ok := existing.(map[string]interface{}); ok {
				if existingID, ok := existingMap["id"].(string); ok && existingID == toolID {
					// Merge/Replace
					// For now, we assume the new event contains the latest state (e.g. result added)
					// But we might want to ensure we don't overwrite arguments if they are missing in the new event (though they shouldn't be)
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
			if partMap, ok := part.(map[string]interface{}); ok {
				if partMap["type"] == "tool_call" {
					if innerTC, ok := partMap["tool_call"].(map[string]interface{}); ok {
						if innerID, ok := innerTC["id"].(string); ok && innerID == toolID {
							partMap["tool_call"] = toolCall
							b.ContentParts[i] = partMap
							foundPart = true
							break
						}
					}
				}
			}
		}
		if !foundPart {
			b.ContentParts = append(b.ContentParts, map[string]interface{}{
				"type":      "tool_call",
				"tool_call": toolCall,
			})
		}
	} else if toolName != "" {
		// Fallback: Try to match by name if ID is missing (common with some models)
		// We look for a pending tool call with the same name.

		// 1. Update in ToolCalls slice
		found := false
		for i, existing := range b.ToolCalls {
			if existingMap, ok := existing.(map[string]interface{}); ok {
				// Check if name matches
				if name, ok := existingMap["name"].(string); ok && name == toolName {
					// Check if existing is pending (no result or status != completed)
					status, _ := existingMap["status"].(string)
					result := existingMap["result"]

					// If existing is not completed, we assume this new event updates it
					if result == nil && status != "completed" {
						b.ToolCalls[i] = toolCall
						found = true
						break
					}
				}
			}
		}
		if !found {
			b.ToolCalls = append(b.ToolCalls, toolCall)
		}

		// 2. Update in ContentParts
		foundPart := false
		for i, part := range b.ContentParts {
			if partMap, ok := part.(map[string]interface{}); ok {
				if partMap["type"] == "tool_call" {
					if innerTC, ok := partMap["tool_call"].(map[string]interface{}); ok {
						if name, ok := innerTC["name"].(string); ok && name == toolName {
							// Check if pending
							status, _ := innerTC["status"].(string)
							result := innerTC["result"]

							if result == nil && status != "completed" {
								partMap["tool_call"] = toolCall
								b.ContentParts[i] = partMap
								foundPart = true
								break
							}
						}
					}
				}
			}
		}
		if !foundPart {
			b.ContentParts = append(b.ContentParts, map[string]interface{}{
				"type":      "tool_call",
				"tool_call": toolCall,
			})
		}
	} else {
		// Fallback: No ID and No Name, always append
		b.ToolCalls = append(b.ToolCalls, toolCall)
		b.ContentParts = append(b.ContentParts, map[string]interface{}{
			"type":      "tool_call",
			"tool_call": toolCall,
		})
	}
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
