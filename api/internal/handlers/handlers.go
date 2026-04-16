package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

func HelloWorld(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "Hello, World!")
}

// userFromCtx extracts the authenticated user from context
// Accepts an interface with a Value method for compatibility with context.Context and gin.Context
func userFromCtx(ctx interface{ Value(key any) any }) (*storage.User, error) {
	// Convert to context.Context to use auth.GetUserFromContext
	if ctxWithValue, ok := ctx.(context.Context); ok {
		user, ok := auth.GetUserFromContext(ctxWithValue)
		if !ok {
			return nil, fmt.Errorf("user not found in context")
		}
		return user, nil
	}

	// Fallback: direct extraction from context
	user, ok := ctx.Value(auth.UserContextKey).(*storage.User)
	if !ok {
		return nil, fmt.Errorf("user not found in context")
	}
	return user, nil
}

// firstNonEmpty returns the first non-empty string from the provided arguments
func firstNonEmpty(strs ...string) string {
	for _, s := range strs {
		if strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}
