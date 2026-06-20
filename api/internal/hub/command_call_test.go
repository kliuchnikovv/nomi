package hub

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

func TestCommandCallOperationConstant(t *testing.T) {
	assert.Equal(t, Operation("command_call"), CommandCallOperation)
}

func TestCommandCallFrameRoundtrips(t *testing.T) {
	payload := map[string]any{
		"name": "memory.note",
		"args": map[string]any{"text": "hello"},
	}
	raw, err := json.Marshal(payload)
	assert.NoError(t, err)

	frame := Frame{
		ID:        7,
		ChatID:    uuid.New(),
		Kind:      SignalKind,
		Operation: CommandCallOperation,
		Payload:   raw,
	}

	out, err := json.Marshal(frame)
	assert.NoError(t, err)

	var roundTrip Frame
	assert.NoError(t, json.Unmarshal(out, &roundTrip))
	assert.Equal(t, CommandCallOperation, roundTrip.Operation)
	assert.Equal(t, "command_call", string(roundTrip.Operation))

	var parsed map[string]any
	assert.NoError(t, json.Unmarshal(roundTrip.Payload, &parsed))
	assert.Equal(t, "memory.note", parsed["name"])
}
