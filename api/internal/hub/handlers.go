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
	// Error handling is usually done at the top level, but we can have a payload handler too
}

func (r *Room) DispatchPayload(frame Frame) error {
	var rawMap map[string]interface{}
	if err := json.Unmarshal(frame.Payload, &rawMap); err != nil {
		return err
	}

	typeStr, ok := rawMap["type"].(string)
	if !ok {
		// Some legacy messages might not have "type".
		// We can try to infer or just log.
		r.logger.Warn("missing type in payload", zap.ByteString("payload", frame.Payload))
		return fmt.Errorf("missing type in payload")
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
	var p TextPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return err
	}
	builder := r.getOrCreateBuilder(p.MessageID, r.ID)
	builder.AppendText(p.Delta)
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
	builder := r.getOrCreateBuilder(p.MessageID, r.ID)
	builder.AppendReasoning(p.Delta)
	return builder.Persist(context.Background(), r.store, r.initiatorID)
}

func handleMemberResponsePayload(r *Room, data []byte) error {
	var p MemberResponsePayload
	if err := json.Unmarshal(data, &p); err != nil {
		return err
	}
	builder := r.getOrCreateBuilder(p.MessageID, r.ID)
	builder.AppendMemberResponse(p.AgentName, p.Delta)
	return builder.Persist(context.Background(), r.store, r.initiatorID)
}

func handleMetadataPayload(r *Room, data []byte) error {
	var p MetadataPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return err
	}
	builder := r.getOrCreateBuilder(p.MessageID, r.ID)
	builder.SetMetadata(p.Model, p.ToolCalls, nil)
	return builder.Persist(context.Background(), r.store, r.initiatorID)
}

func handleActionsPayload(r *Room, data []byte) error {
	var p ActionsPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return err
	}
	builder := r.getOrCreateBuilder(p.MessageID, r.ID)
	builder.SetMetadata("", nil, p.Actions)
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
