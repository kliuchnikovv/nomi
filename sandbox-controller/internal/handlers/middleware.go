package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/sandbox-controller/internal/config"
)

// AuthMiddleware creates authentication middleware
func AuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Skip auth for health checks
		if c.Request.URL.Path == "/health" {
			c.Next()
			return
		}

		// Get token from header
		token := c.GetHeader("X-Controller-Token")
		if token == "" {
			// Also check Authorization header
			auth := c.GetHeader("Authorization")
			if strings.HasPrefix(auth, "Bearer ") {
				token = strings.TrimPrefix(auth, "Bearer ")
			}
		}

		// Validate token
		if cfg.ControllerToken != "" && token != cfg.ControllerToken {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid or missing authentication token",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
