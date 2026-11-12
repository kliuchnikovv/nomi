package auth

import (
	"context"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/nomi-api/internal/storage"
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
// When INTERNAL_SERVICE_TOKEN is not configured, X-User-ID alone is accepted
// for internal service-to-service calls (both services on same host).
func (am *AuthMiddleware) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serviceToken := os.Getenv("INTERNAL_SERVICE_TOKEN")

		// Internal service-to-service: X-User-ID present, no JWT needed
		if userIDStr := r.Header.Get("X-User-ID"); userIDStr != "" {
			authHeader := r.Header.Get("Authorization")
			// Validate service token when configured
			if serviceToken != "" {
				parts := strings.SplitN(authHeader, " ", 2)
				if len(parts) != 2 || parts[0] != "Bearer" || parts[1] != serviceToken {
					http.Error(w, "Invalid service token", http.StatusUnauthorized)
					return
				}
			}
			userID, err := uuid.Parse(userIDStr)
			if err != nil {
				http.Error(w, "Invalid X-User-ID", http.StatusUnauthorized)
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

		// Standard JWT path
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "Authorization header is required", http.StatusUnauthorized)
			return
		}
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			http.Error(w, "Invalid authorization header format", http.StatusUnauthorized)
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
