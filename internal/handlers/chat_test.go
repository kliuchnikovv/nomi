package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/stretchr/testify/assert"
)

func TestChatHandler_CreateChat(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s, mock, err := setupTestDB()
	assert.NoError(t, err)

	h := NewChatHandler(s)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	// Create a dummy request to have a context
	req, _ := http.NewRequest("POST", "/api/chats", nil)
	c.Request = req

	user := &storage.User{
		ID:    uuid.New(),
		Email: "test@example.com",
	}
	ctx := context.WithValue(c.Request.Context(), auth.UserContextKey, user)

	newChat := chat.Chat{
		Model: uuid.New(),
		Title: "New Chat",
	}
	jsonBody, _ := json.Marshal(newChat)
	// We already created request, but body was empty. Recreate it.
	req, _ = http.NewRequest("POST", "/api/chats", bytes.NewBuffer(jsonBody))
	c.Request = req.WithContext(ctx)

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO "chats"`).
		WithArgs(user.ID, newChat.Model, newChat.Title, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(uuid.New()))
	mock.ExpectCommit()

	h.CreateChat(c)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestChatHandler_ListChats(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s, mock, err := setupTestDB()
	assert.NoError(t, err)

	h := NewChatHandler(s)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	// dummy req for context
	req, _ := http.NewRequest("GET", "/api/chats", nil)
	c.Request = req

	user := &storage.User{
		ID:    uuid.New(),
		Email: "test@example.com",
	}
	ctx := context.WithValue(c.Request.Context(), auth.UserContextKey, user)
	c.Request = req.WithContext(ctx)

	chatID := uuid.New()
	mock.ExpectQuery(`SELECT \* FROM "chats" WHERE user_id = \$1 AND "chats"."deleted_at" IS NULL`).
		WithArgs(user.ID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title"}).AddRow(chatID, "Chat 1"))

	h.ListChats(c)

	assert.Equal(t, http.StatusOK, w.Code)
	var chats []chat.Chat
	err = json.Unmarshal(w.Body.Bytes(), &chats)
	assert.NoError(t, err)
	assert.Len(t, chats, 1)
}

func TestChatHandler_GetChat(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s, mock, err := setupTestDB()
	assert.NoError(t, err)

	h := NewChatHandler(s)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	// dummy req
	req, _ := http.NewRequest("GET", "/api/chats/foo", nil)
	c.Request = req

	user := &storage.User{
		ID:    uuid.New(),
		Email: "test@example.com",
	}
	ctx := context.WithValue(c.Request.Context(), auth.UserContextKey, user)

	chatID := uuid.New()
	req, _ = http.NewRequest("GET", "/api/chats/" + chatID.String(), nil)
	c.Request = req.WithContext(ctx)
	c.Params = []gin.Param{{Key: "id", Value: chatID.String()}}

	mock.ExpectQuery(`SELECT \* FROM "chats" WHERE \(id = \$1 AND user_id = \$2\) AND "chats"."deleted_at" IS NULL ORDER BY "chats"."id" LIMIT \$3`).
		WithArgs(chatID, user.ID, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "created_at", "updated_at"}).AddRow(chatID, "Chat 1", time.Now(), time.Now()))

	h.GetChat(c)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestChatHandler_DeleteChat(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s, mock, err := setupTestDB()
	assert.NoError(t, err)

	h := NewChatHandler(s)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	// dummy req
	req, _ := http.NewRequest("DELETE", "/api/chats/foo", nil)
	c.Request = req

	user := &storage.User{
		ID:    uuid.New(),
		Email: "test@example.com",
	}
	ctx := context.WithValue(c.Request.Context(), auth.UserContextKey, user)

	chatID := uuid.New()
	req, _ = http.NewRequest("DELETE", "/api/chats/" + chatID.String(), nil)
	c.Request = req.WithContext(ctx)
	c.Params = []gin.Param{{Key: "id", Value: chatID.String()}}

	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE "chats" SET "deleted_at"=\$1 WHERE \(id = \$2 AND user_id = \$3\) AND "chats"."deleted_at" IS NULL`).
		WithArgs(sqlmock.AnyArg(), chatID, user.ID).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	h.DeleteChat(c)

	assert.Equal(t, http.StatusNoContent, w.Code)
}
