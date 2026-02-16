package hub

import (
	"context"
	"encoding/json"

	"fmt"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

type PayloadHandler func(r *Room, payload []byte) error

var payloadHandlers = map[PayloadType]PayloadHandler{
	PayloadTypeText:           handleTextPayload,
	PayloadTypeToolCall:       handleToolCallPayload,
	PayloadTypeReasoning:      handleReasoningPayload,
	PayloadTypeMemberResponse: handleMemberResponsePayload,
	PayloadTypeMetadata:       handleMetadataPayload,
	PayloadTypeActions:        handleActionsPayload,
	PayloadTypeChatUpdate:     handleChatUpdatePayload,
	PayloadTypeClientAction:   handleClientActionPayload,
	// Error handling is usually done at the top level, but we can have a payload handler too
}

func (r *Room) DispatchPayload(frame Frame) error {
	var rawMap map[string]interface{}
	if err := json.Unmarshal(frame.Payload, &rawMap); err != nil {
		return err
	}

	typeStr, ok := rawMap["type"].(string)
	if !ok {
		// Fallback: if 'message' is present, assume 'text' (legacy Python backend behavior)
		if _, hasMsg := rawMap["message"]; hasMsg {
			typeStr = string(PayloadTypeText)
		} else {
			r.logger.Warn("missing type in payload", zap.ByteString("payload", frame.Payload))
			return fmt.Errorf("missing type in payload")
		}
	}

	handler, ok := payloadHandlers[PayloadType(typeStr)]
	if !ok {
		r.logger.Warn("unknown payload type", zap.String("type", typeStr))
		return fmt.Errorf("unknown payload type: %s", typeStr)
	}

	return handler(r, frame.Payload)
}

// Internal helpers using MessageBuilder

func (r *Room) getOrCreateBuilder(msgID, chatID uuid.UUID) *MessageBuilder {
	if builder, ok := r.messageBuilders[msgID]; ok {
		return builder
	}
	builder := NewMessageBuilder(msgID, chatID, r.logger)
	r.messageBuilders[msgID] = builder
	return builder
}

func handleTextPayload(r *Room, data []byte) error {
	// Persist text chunks even when streaming so GET /messages returns full state
	// on other devices; DONE frame still overwrites with canonical content.
	var p TextPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return err
	}
	delta := p.Delta
	if delta == "" {
		delta = p.Message
	}
	builder := r.getOrCreateBuilder(p.MessageID, r.ID)
	builder.AppendText(delta)
	return builder.Persist(context.Background(), r.store, r.initiatorID)
}

func handleToolCallPayload(r *Room, data []byte) error {
	var p ToolCallPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return err
	}
	builder := r.getOrCreateBuilder(p.MessageID, r.ID)
	builder.AddToolCall(p.ToolCall)
	return builder.Persist(context.Background(), r.store, r.initiatorID)
}

func handleReasoningPayload(r *Room, data []byte) error {
	var p ReasoningPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return err
	}
	delta := p.Delta
	if delta == "" {
		delta = p.Content
	}
	builder := r.getOrCreateBuilder(p.MessageID, r.ID)
	builder.AppendReasoning(delta)
	return builder.Persist(context.Background(), r.store, r.initiatorID)
}

func handleMemberResponsePayload(r *Room, data []byte) error {
	var p MemberResponsePayload
	if err := json.Unmarshal(data, &p); err != nil {
		return err
	}
	delta := p.Delta
	if delta == "" {
		delta = p.Message
	}
	builder := r.getOrCreateBuilder(p.MessageID, r.ID)
	builder.AppendMemberResponse(p.AgentName, delta)
	return builder.Persist(context.Background(), r.store, r.initiatorID)
}

func handleMetadataPayload(r *Room, data []byte) error {
	var p MetadataPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return err
	}
	builder := r.getOrCreateBuilder(p.MessageID, r.ID)
	builder.SetModel(p.Model)
	builder.SetToolCalls(p.ToolCalls)
	return builder.Persist(context.Background(), r.store, r.initiatorID)
}

func handleActionsPayload(r *Room, data []byte) error {
	var p ActionsPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return err
	}
	builder := r.getOrCreateBuilder(p.MessageID, r.ID)
	builder.SetActions(p.Actions)
	return builder.Persist(context.Background(), r.store, r.initiatorID)
}

func handleChatUpdatePayload(r *Room, data []byte) error {
	var p ChatUpdatePayload
	if err := json.Unmarshal(data, &p); err != nil {
		return err
	}
	// Logic to update chat title
	r.logger.Info("Chat update received", zap.String("message", p.Message))
	// Implement chat title update if needed, similar to old logic
	return nil
}

func handleClientActionPayload(r *Room, data []byte) error {
	// client_action payloads are sent to mobile clients for execution
	// They don't need to be persisted to the database
	// Just return nil to avoid "unknown payload type" error
	r.logger.Debug("client_action payload received (not persisted)")
	return nil
}
