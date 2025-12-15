package auth

import (
    "errors"
    "crypto/rand"
    "encoding/base64"
    "time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("token has expired")
)

type Claims struct {
	UserID uuid.UUID `json:"user_id"`
	jwt.RegisteredClaims
}

type TokenManager struct {
	secretKey []byte
}

func NewTokenManager(secretKey string) *TokenManager {
	return &TokenManager{
		secretKey: []byte(secretKey),
	}
}

// GenerateToken создает новый JWT токен для пользователя
func (tm *TokenManager) GenerateToken(user *storage.User) (string, error) {
	claims := &Claims{
		UserID: user.ID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)), // Токен действителен 24 часа
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(tm.secretKey)
}

// GenerateRefreshToken creates a secure random opaque token string
func (tm *TokenManager) GenerateRefreshToken() (string, error) {
    b := make([]byte, 32)
    if _, err := rand.Read(b); err != nil {
        return "", err
    }
    // URL-safe base64
    return base64.RawURLEncoding.EncodeToString(b), nil
}

// ValidateToken проверяет JWT токен и возвращает claims
func (tm *TokenManager) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return tm.secretKey, nil
	})

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}

	return claims, nil
}
