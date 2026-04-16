package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/kliuchnikovv/genie-api/internal/storage"
)

type contextKey string

const (
	UserContextKey contextKey = "user"
)

type AuthMiddleware struct {
	tokenManager *TokenManager
	storage      *storage.Storage
}

func NewAuthMiddleware(tokenManager *TokenManager, storage *storage.Storage) *AuthMiddleware {
	return &AuthMiddleware{
		tokenManager: tokenManager,
		storage:      storage,
	}
}

// GetUserFromContext returns the user from context
func GetUserFromContext(ctx context.Context) (*storage.User, bool) {
	user, ok := ctx.Value(UserContextKey).(*storage.User)
	return user, ok
}

// RequireAuth is a middleware for JWT token validation
func (am *AuthMiddleware) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Get token from Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "Authorization header is required", http.StatusUnauthorized)
			return
		}

		// Check token format "Bearer <token>"
		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			http.Error(w, "Invalid authorization header format", http.StatusUnauthorized)
			return
		}

		// Validate token
		claims, err := am.tokenManager.ValidateToken(parts[1])
		if err != nil {
			if err == ErrExpiredToken {
				http.Error(w, "Token has expired", http.StatusUnauthorized)
			} else {
				http.Error(w, "Invalid token", http.StatusUnauthorized)
			}
			return
		}

		// Get user from database
		user, err := am.storage.GetUserByID(r.Context(), claims.UserID)
		if err != nil {
			http.Error(w, "User not found", http.StatusUnauthorized)
			return
		}

		// Add user to context
		ctx := context.WithValue(r.Context(), UserContextKey, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
