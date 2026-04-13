package hub

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

func TestSendGenerationTimeoutError_UsesErrorInfo(t *testing.T) {
	room := &Room{
		ID:           uuid.New(),
		Type:         RoomTypeChat,
		initiatorID:  uuid.New(),
		clients:      make(map[*Client]bool),
		logger:       zap.NewNop(),
		messageBuilders: make(map[uuid.UUID]*MessageBuilder),
	}

	// Capture the error frame by adding a fake client
	client := &Client{
		room:    room,
		send:    make(chan []byte, 8),
		userID:  uuid.New(),
		logger:  zap.NewNop(),
	}
	room.clients[client] = true

	// Call the timeout method
	room.sendGenerationTimeoutError()

	// Read the frame from the client's send channel
	select {
	case raw := <-client.send:
		var frame Frame
		if err := json.Unmarshal(raw, &frame); err != nil {
			t.Fatalf("failed to unmarshal frame: %v", err)
		}

		// Verify the frame uses ErrorKind (not SignalKind)
		if frame.Kind != ErrorKind {
			t.Errorf("expected Kind=%q, got %q", ErrorKind, frame.Kind)
		}

		// Verify the frame uses ErrorOperation
		if frame.Operation != ErrorOperation {
			t.Errorf("expected Operation=%q, got %q", ErrorOperation, frame.Operation)
		}

		// Verify ErrorInfo is populated (this is what the frontend parses)
		if frame.Error.Code != ErrorCodeTimeout {
			t.Errorf("expected Error.Code=%q, got %q", ErrorCodeTimeout, frame.Error.Code)
		}
		if frame.Error.Message == "" {
			t.Error("expected Error.Message to be non-empty")
		}
		if frame.Error.CodeHTTP != 500 {
			t.Errorf("expected Error.CodeHTTP=500, got %d", frame.Error.CodeHTTP)
		}

		// Verify the old Payload-based format is NOT used
		if len(frame.Payload) > 0 {
			var payload map[string]interface{}
			if err := json.Unmarshal(frame.Payload, &payload); err == nil {
				if _, ok := payload["code"]; ok {
					t.Error("error should be in Frame.Error, not in Frame.Payload")
				}
			}
		}

		t.Logf("OK: timeout error frame uses ErrorInfo: code=%q message=%q", frame.Error.Code, frame.Error.Message)

	default:
		t.Fatal("no frame received from sendGenerationTimeoutError")
	}
}
