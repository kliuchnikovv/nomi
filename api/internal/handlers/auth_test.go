package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"golang.org/x/crypto/bcrypt"
)

type MockAuthStorer struct {
	mock.Mock
}

func (m *MockAuthStorer) GetUserByEmail(ctx context.Context, email string) (*storage.User, error) {
	args := m.Called(ctx, email)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*storage.User), args.Error(1)
}

func (m *MockAuthStorer) SaveRefreshToken(ctx context.Context, userID uuid.UUID, token string, ttl time.Duration) error {
	args := m.Called(ctx, userID, token, ttl)
	return args.Error(0)
}

func (m *MockAuthStorer) CreateUser(ctx context.Context, email, password, name string) (*storage.User, error) {
	args := m.Called(ctx, email, password, name)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*storage.User), args.Error(1)
}

func (m *MockAuthStorer) ConsumeRefreshToken(ctx context.Context, token string) (*storage.RefreshToken, error) {
	args := m.Called(ctx, token)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*storage.RefreshToken), args.Error(1)
}

func (m *MockAuthStorer) GetUserByID(ctx context.Context, id uuid.UUID) (*storage.User, error) {
	args := m.Called(ctx, id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*storage.User), args.Error(1)
}

func (m *MockAuthStorer) UpdateUser(ctx context.Context, user *storage.User) error {
	args := m.Called(ctx, user)
	return args.Error(0)
}

type MockAuthTokenManager struct {
	mock.Mock
}

func (m *MockAuthTokenManager) GenerateToken(user *storage.User) (string, error) {
	args := m.Called(user)
	return args.String(0), args.Error(1)
}

func (m *MockAuthTokenManager) GenerateRefreshToken() (string, error) {
	args := m.Called()
	return args.String(0), args.Error(1)
}

func TestAuthHandler_Login(t *testing.T) {
	t.Run("successful login", func(t *testing.T) {
		password := "password"
		hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		user := &storage.User{
			ID:           uuid.New(),
			Email:        "test@example.com",
			PasswordHash: string(hashedPassword),
		}

		mockStorage := new(MockAuthStorer)
		mockTokenManager := new(MockAuthTokenManager)

		mockStorage.On("GetUserByEmail", mock.Anything, user.Email).Return(user, nil)
		mockStorage.On("SaveRefreshToken", mock.Anything, user.ID, "test-refresh-token", mock.AnythingOfType("time.Duration")).Return(nil)
		mockTokenManager.On("GenerateToken", user).Return("test-token", nil)
		mockTokenManager.On("GenerateRefreshToken").Return("test-refresh-token", nil)

		handler := NewAuthHandler(mockStorage, mockTokenManager)

		loginRequest := LoginRequest{
			Email:    user.Email,
			Password: password,
		}
		requestBody, _ := json.Marshal(loginRequest)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBuffer(requestBody))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()

		handler.Login(rr, req)

		assert.Equal(t, http.StatusOK, rr.Code)

		var authResponse AuthResponse
		err := json.Unmarshal(rr.Body.Bytes(), &authResponse)
		assert.NoError(t, err)

		assert.Equal(t, "test-token", authResponse.Token)
		assert.Equal(t, "test-refresh-token", authResponse.RefreshToken)

		mockStorage.AssertExpectations(t)
		mockTokenManager.AssertExpectations(t)
	})
}
