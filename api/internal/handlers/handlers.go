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

// userFromCtx извлекает аутентифицированного пользователя из контекста
// Принимает интерфейс с методом Value для совместимости с context.Context и gin.Context
func userFromCtx(ctx interface{ Value(key any) any }) (*storage.User, error) {
	// Преобразуем в context.Context для использования auth.GetUserFromContext
	if ctxWithValue, ok := ctx.(context.Context); ok {
		user, ok := auth.GetUserFromContext(ctxWithValue)
		if !ok {
			return nil, fmt.Errorf("user not found in context")
		}
		return user, nil
	}

	// Fallback: прямое извлечение из контекста
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
