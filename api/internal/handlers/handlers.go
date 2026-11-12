package handlers

import (
	"context"
	"fmt"

	"github.com/kliuchnikovv/nomi-api/internal/auth"
	"github.com/kliuchnikovv/nomi-api/internal/storage"
)

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
