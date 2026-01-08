package server

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/mux"
	"github.com/kliuchnikovv/genie-api/internal/auth"
)

// wrap converts a standard http.HandlerFunc into a gin.HandlerFunc and
// populates mux URL vars from gin path params so existing handlers that
// rely on mux.Vars() continue to work.
func wrap(h http.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		vars := map[string]string{}
		for _, p := range c.Params {
			vars[p.Key] = p.Value
		}
		req := mux.SetURLVars(c.Request, vars)
		h(c.Writer, req)
	}
}

// wrapWithAuth оборачивает gin.HandlerFunc в middleware авторизации
func wrapWithAuth(h gin.HandlerFunc, authMiddleware *auth.AuthMiddleware) gin.HandlerFunc {
	return func(c *gin.Context) {
		wrapped := gin.WrapH(authMiddleware.RequireAuth(
			http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Восстанавливаем gin.Context из http.Request
				c.Request = r
				
				// Extract user from request context and set in Gin context
				if user, ok := auth.GetUserFromContext(r.Context()); ok {
					c.Set("userID", user.ID)
					c.Set("user", user)
				}
				
				h(c)
			}),
		))
		wrapped(c)
	}
}

// wrapWithAuthHttp оборачивает http.HandlerFunc в middleware авторизации
func wrapWithAuthHttp(h http.HandlerFunc, authMiddleware *auth.AuthMiddleware) gin.HandlerFunc {
	return gin.WrapH(authMiddleware.RequireAuth(h))
}
