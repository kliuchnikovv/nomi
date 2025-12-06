package auth

import (
	"testing"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/stretchr/testify/assert"
)

func TestTokenManager_GenerateToken(t *testing.T) {
	secret := "secret_key"
	tm := NewTokenManager(secret)
	userID := uuid.New()
	user := &storage.User{
		ID:    userID,
		Email: "test@example.com",
	}

	token, err := tm.GenerateToken(user)
	assert.NoError(t, err)
	assert.NotEmpty(t, token)

	claims, err := tm.ValidateToken(token)
	assert.NoError(t, err)
	assert.Equal(t, userID, claims.UserID)
}

func TestTokenManager_ValidateToken_Invalid(t *testing.T) {
	secret := "secret_key"
	tm := NewTokenManager(secret)

	_, err := tm.ValidateToken("invalid_token")
	assert.Error(t, err)
	assert.Equal(t, ErrInvalidToken, err)
}

func TestTokenManager_GenerateRefreshToken(t *testing.T) {
	tm := NewTokenManager("secret")
	token, err := tm.GenerateRefreshToken()
	assert.NoError(t, err)
	assert.NotEmpty(t, token)
	assert.True(t, len(token) > 10)
}
