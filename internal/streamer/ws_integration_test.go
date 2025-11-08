package streamer

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type MockConn struct {
	numberOfReads int
	readsDone     int
}

func (conn *MockConn) ReadMessage() (messageType int, p []byte, err error) {
	defer func() {
		conn.readsDone++
	}()

	if conn.numberOfReads > conn.readsDone {
		return 1, []byte("{\"id\":1,\"kind\":\"data\",\"op\":\"message\",\"payload\":{\"message\":\"Проверка\"}}"), nil
	}

	return 1, []byte("{\"id\":1,\"kind\":\"data\",\"op\":\"done\",\"payload\":{\"message\":\"done\"}}"), nil
}

func (conn *MockConn) WriteMessage(messageType int, data []byte) error {
	return nil
}

// TestWSUpstream_Echo spins up a WS server at 0.0.0.0:7777/llm/ws,
// connects with Cookie: session_id=sess-123, sends two messages,
// waits for responses, and then closes.
func TestWSUpstream_Echo(t *testing.T) {
	db, _ := storage.New(&config.Config{
		Database: struct {
			Host     string "yaml:\"host\""
			Port     int    "yaml:\"port\""
			User     string "yaml:\"user\""
			Password string "yaml:\"password\""
			DBName   string "yaml:\"dbname\""
		}{
			Host:     "localhost",
			Port:     5432,
			User:     "postgres",
			Password: "postgres",
			DBName:   "postgres",
		},
	})

	streamer := New(db, zap.NewExample(), uuid.New(), uuid.New(), func() (*websocket.Conn, error) {
		// Prepare WS URL
		u := url.URL{Scheme: "ws", Host: "0.0.0.0:7777", Path: "/llm/ws", RawQuery: "chat_id=demo"}

		// Add Cookie header for auth
		hdr := http.Header{}
		hdr.Add("Cookie", "session_id=sess-123")

		conn, _, err := websocket.DefaultDialer.Dial(u.String(), hdr)
		if err != nil {
			t.Fatalf("dial failed: %v", err)
		}
		return conn, nil
	})

	streamer.Stream(NewSocketReader(
		&MockConn{
			numberOfReads: 2,
		},
		zap.NewExample(),
	))
}
