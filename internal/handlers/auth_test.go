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
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/stretchr/testify/assert"
	"golang.org/x/crypto/bcrypt"
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

func TestAuthHandler_Register(t *testing.T) {
	gin.SetMode(gin.TestMode)

	s, mock, err := setupTestDB()
	assert.NoError(t, err)

	tm := auth.NewTokenManager("secret")
	h := NewAuthHandler(s, tm)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	reqBody := RegisterRequest{
		Email:    "test@example.com",
		Password: "password",
		Name:     "Test User",
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", "/api/auth/register", bytes.NewBuffer(jsonBody))
	c.Request = req

	userID := uuid.New()

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO "users"`).
		WithArgs(reqBody.Email, sqlmock.AnyArg(), reqBody.Name, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(userID))
	mock.ExpectCommit()

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO "refresh_tokens"`).
		WithArgs(userID, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(uuid.New()))
	mock.ExpectCommit()

	h.Register(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp AuthResponse
	err = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.NoError(t, err)
	assert.Equal(t, reqBody.Email, resp.User.Email)
	assert.NotEmpty(t, resp.Token)
	assert.NotEmpty(t, resp.RefreshToken)
}

func TestAuthHandler_Login(t *testing.T) {
	gin.SetMode(gin.TestMode)

	s, mock, err := setupTestDB()
	assert.NoError(t, err)

	tm := auth.NewTokenManager("secret")
	h := NewAuthHandler(s, tm)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	reqBody := LoginRequest{
		Email:    "test@example.com",
		Password: "password",
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", "/api/auth/login", bytes.NewBuffer(jsonBody))
	c.Request = req

	userID := uuid.New()
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.DefaultCost)

	mock.ExpectQuery(`SELECT \* FROM "users" WHERE email = \$1 AND "users"."deleted_at" IS NULL ORDER BY "users"\."id" LIMIT \$2`).
		WithArgs(reqBody.Email, 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "email", "password_hash", "name"}).
			AddRow(userID, reqBody.Email, string(hash), "Test User"))

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO "refresh_tokens"`).
		WithArgs(userID, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(uuid.New()))
	mock.ExpectCommit()

	h.Login(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp AuthResponse
	err = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.NoError(t, err)
	assert.Equal(t, reqBody.Email, resp.User.Email)
	assert.NotEmpty(t, resp.Token)
}

func TestAuthHandler_GetMe(t *testing.T) {
	gin.SetMode(gin.TestMode)

	s, _, err := setupTestDB()
	assert.NoError(t, err)

	tm := auth.NewTokenManager("secret")
	h := NewAuthHandler(s, tm)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req, _ := http.NewRequest("GET", "/api/auth/me", nil)

	user := &storage.User{
		ID:    uuid.New(),
		Email: "test@example.com",
		Name:  "Test User",
        CreatedAt: time.Now(),
        UpdatedAt: time.Now(),
	}
	ctx := context.WithValue(req.Context(), auth.UserContextKey, user)
    req = req.WithContext(ctx)
    c.Request = req

	h.GetMe(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
    var respUser storage.User
    err = json.Unmarshal(w.Body.Bytes(), &respUser)
    assert.NoError(t, err)
    assert.Equal(t, user.ID, respUser.ID)
    assert.Equal(t, user.Email, respUser.Email)
}
