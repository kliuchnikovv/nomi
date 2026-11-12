package handlers

import (
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/nomi-api/internal/config"
	"go.uber.org/zap"
)

// ProxyCommands forwards GET /api/commands to the Python backend, injecting X-User-ID.
func ProxyCommands(cfg *config.Config, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		targetURL := cfg.LLM.BaseURL
		if targetURL == "" {
			targetURL = "http://127.0.0.1:7777"
		}

		proxyReq, err := http.NewRequest(http.MethodGet, targetURL+"/commands", nil)
		if err != nil {
			logger.Error("ProxyCommands: failed to create request", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create proxy request"})
			return
		}

		for name, values := range c.Request.Header {
			for _, value := range values {
				proxyReq.Header.Add(name, value)
			}
		}

		if userID, exists := c.Get("userID"); exists {
			proxyReq.Header.Set("X-User-ID", fmt.Sprintf("%v", userID))
		}

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(proxyReq)
		if err != nil {
			logger.Error("ProxyCommands: backend request failed", zap.Error(err))
			c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to contact AI service"})
			return
		}
		defer resp.Body.Close()

		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			logger.Error("ProxyCommands: failed to read response", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read response"})
			return
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			logger.Warn("ProxyCommands: non-2xx from backend",
				zap.Int("status", resp.StatusCode),
				zap.String("body", string(bodyBytes)))
		}

		for name, values := range resp.Header {
			for _, value := range values {
				c.Writer.Header().Add(name, value)
			}
		}
		c.Status(resp.StatusCode)
		_, _ = c.Writer.Write(bodyBytes)
	}
}
