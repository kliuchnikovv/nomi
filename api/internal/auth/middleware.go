package auth

import (
	"context"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
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

// RequireAuth is a middleware for JWT token validation.
// Also accepts internal service token: Authorization: Bearer <INTERNAL_SERVICE_TOKEN>
// with X-User-ID header for Python backend calls.
func (am *AuthMiddleware) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "Authorization header is required", http.StatusUnauthorized)
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			http.Error(w, "Invalid authorization header format", http.StatusUnauthorized)
			return
		}

		// Service token path for internal Python → Go calls
		serviceToken := os.Getenv("INTERNAL_SERVICE_TOKEN")
		if serviceToken != "" && parts[1] == serviceToken {
			userIDStr := r.Header.Get("X-User-ID")
			userID, err := uuid.Parse(userIDStr)
			if err != nil {
				http.Error(w, "X-User-ID required for service token auth", http.StatusUnauthorized)
				return
			}
			user, err := am.storage.GetUserByID(r.Context(), userID)
			if err != nil {
				http.Error(w, "User not found", http.StatusUnauthorized)
				return
			}
			ctx := context.WithValue(r.Context(), UserContextKey, user)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		claims, err := am.tokenManager.ValidateToken(parts[1])
		if err != nil {
			if err == ErrExpiredToken {
				http.Error(w, "Token has expired", http.StatusUnauthorized)
			} else {
				http.Error(w, "Invalid token", http.StatusUnauthorized)
			}
			return
		}

		user, err := am.storage.GetUserByID(r.Context(), claims.UserID)
		if err != nil {
			http.Error(w, "User not found", http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), UserContextKey, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
