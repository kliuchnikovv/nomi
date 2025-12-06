package streamer

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func setupTestDB() (*storage.Storage, sqlmock.Sqlmock, error) {
	db, mock, err := sqlmock.New()
	if err != nil {
		return nil, nil, err
	}

	dialector := postgres.New(postgres.Config{
		Conn:       db,
		DriverName: "postgres",
	})

	gdb, err := gorm.Open(dialector, &gorm.Config{})
	if err != nil {
		return nil, nil, err
	}

	return &storage.Storage{DB: gdb}, mock, nil
}

func TestStreamer_Stream(t *testing.T) {
	logger := zap.NewNop()
	s, mock, err := setupTestDB()
	assert.NoError(t, err)

	userID := uuid.New()

	// Expect GetTools call
	mock.ExpectQuery(`SELECT \* FROM "tools" WHERE user_id = \$1`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name"}).AddRow(uuid.New(), "tool1"))

	// Mock model connection
	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{}
		c, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		// Read init message
		_, _, _ = c.ReadMessage()
		// Read tools
		_, _, _ = c.ReadMessage()
	}))
	defer modelServer.Close()

	connectModel := func() (*websocket.Conn, error) {
		wsURL := "ws" + strings.TrimPrefix(modelServer.URL, "http")
		c, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
		return c, err
	}

	streamer := New(s, logger, userID, "Hello", connectModel)

	// Mock client connection
	clientServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{}
		c, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()

		_ = NewSocketReader(c, logger)

		// Run streamer in goroutine? No, Streamer.Stream is blocking and takes a client *Socket.
		// So we need to act as the server-side client handler calling Stream.
		// Wait, Streamer.Stream takes *Socket which wraps the client connection.
		// So we simulate the handler calling streamer.Stream(clientSocket).
	}))
	defer clientServer.Close()

	// We need a real websocket connection to pass to Stream()
	wsURL := "ws" + strings.TrimPrefix(clientServer.URL, "http")
	clientConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	assert.NoError(t, err)
	defer clientConn.Close()

	clientSocket := NewSocketReader(clientConn, logger)

	// Run Stream in a goroutine because it blocks
	go func() {
		streamer.Stream(clientSocket)
	}()

	// Give it some time
	time.Sleep(200 * time.Millisecond)

	// Close client to stop Stream
	clientConn.Close()
	time.Sleep(100 * time.Millisecond)
}
