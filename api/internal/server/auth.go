package server

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/mux"
	"github.com/kliuchnikovv/nomi-api/internal/auth"
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

// wrapWithAuth wraps gin.HandlerFunc with auth middleware
func wrapWithAuth(h gin.HandlerFunc, authMiddleware *auth.AuthMiddleware) gin.HandlerFunc {
	return func(c *gin.Context) {
		wrapped := gin.WrapH(authMiddleware.RequireAuth(
			http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Restore gin.Context from http.Request
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
