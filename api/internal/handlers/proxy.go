package handlers

import (
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"go.uber.org/zap"
)

// ProxyEmbeddings forwards embeddings requests to Python backend
func ProxyEmbeddings(cfg *config.Config, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		targetURL := cfg.LLM.BaseURL
		if targetURL == "" {
			targetURL = "http://127.0.0.1:7777"
		}

		proxyReq, err := http.NewRequest(c.Request.Method, targetURL+"/embeddings", c.Request.Body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create proxy request"})
			return
		}

		for name, values := range c.Request.Header {
			for _, value := range values {
				proxyReq.Header.Add(name, value)
			}
		}

		client := &http.Client{Timeout: 60 * time.Second}
		resp, err := client.Do(proxyReq)
		if err != nil {
			logger.Error("Failed to proxy embeddings request", zap.Error(err))
			c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to contact AI service"})
			return
		}
		defer resp.Body.Close()

		for name, values := range resp.Header {
			for _, value := range values {
				c.Writer.Header().Add(name, value)
			}
		}
		c.Status(resp.StatusCode)

		_, _ = io.Copy(c.Writer, resp.Body)
	}
}

// ProxyGitHub forwards GitHub repo requests to Python backend
func ProxyGitHub(cfg *config.Config, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		targetURL := cfg.LLM.BaseURL
		if targetURL == "" {
			targetURL = "http://127.0.0.1:7777"
		}

		proxyReq, err := http.NewRequest(c.Request.Method, targetURL+"/api/github/repos", c.Request.Body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create proxy request"})
			return
		}

		for name, values := range c.Request.Header {
			for _, value := range values {
				proxyReq.Header.Add(name, value)
			}
		}

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(proxyReq)
		if err != nil {
			logger.Error("Failed to proxy github repos request", zap.Error(err))
			c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to contact AI service"})
			return
		}
		defer resp.Body.Close()

		for name, values := range resp.Header {
			for _, value := range values {
				c.Writer.Header().Add(name, value)
			}
		}
		c.Status(resp.StatusCode)

		_, _ = io.Copy(c.Writer, resp.Body)
	}
}

// ProxyPlugin forwards a request to a Python plugin endpoint (public, no auth injection).
// Used for webhooks that come from external services (e.g. Telegram).
func ProxyPlugin(cfg *config.Config, logger *zap.Logger, backendPath string) gin.HandlerFunc {
	return func(c *gin.Context) {
		targetURL := cfg.LLM.BaseURL
		if targetURL == "" {
			targetURL = "http://127.0.0.1:7777"
		}

		proxyReq, err := http.NewRequest(c.Request.Method, targetURL+backendPath, c.Request.Body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create proxy request"})
			return
		}

		for name, values := range c.Request.Header {
			for _, value := range values {
				proxyReq.Header.Add(name, value)
			}
		}

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(proxyReq)
		if err != nil {
			logger.Error("Failed to proxy plugin request", zap.Error(err), zap.String("path", backendPath))
			c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to contact plugin service"})
			return
		}
		defer resp.Body.Close()

		// Log warnings for non-2xx responses to make them more visible
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			logger.Warn("Plugin request returned non-success status",
				zap.Int("status_code", resp.StatusCode),
				zap.String("path", backendPath),
				zap.String("method", c.Request.Method))
		}

		for name, values := range resp.Header {
			for _, value := range values {
				c.Writer.Header().Add(name, value)
			}
		}
		c.Status(resp.StatusCode)
		_, _ = io.Copy(c.Writer, resp.Body)
	}
}

// ProxyPluginHandler forwards an authenticated request to a Python plugin endpoint.
// Injects the user ID from auth middleware into the X-User-ID header for the plugin.
func ProxyPluginHandler(cfg *config.Config, logger *zap.Logger, backendPath string) gin.HandlerFunc {
	return func(c *gin.Context) {
		targetURL := cfg.LLM.BaseURL
		if targetURL == "" {
			targetURL = "http://127.0.0.1:7777"
		}

		proxyReq, err := http.NewRequest(c.Request.Method, targetURL+backendPath, c.Request.Body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create proxy request"})
			return
		}

		for name, values := range c.Request.Header {
			for _, value := range values {
				proxyReq.Header.Add(name, value)
			}
		}

		// Inject authenticated user ID so the Python plugin can identify the user
		if userID, exists := c.Get("userID"); exists {
			proxyReq.Header.Set("X-User-ID", fmt.Sprintf("%v", userID))
		}

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(proxyReq)
		if err != nil {
			logger.Error("Failed to proxy plugin request", zap.Error(err), zap.String("path", backendPath))
			c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to contact plugin service"})
			return
		}
		defer resp.Body.Close()

		// Log warnings for non-2xx responses to make them more visible
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			logger.Warn("Plugin request returned non-success status",
				zap.Int("status_code", resp.StatusCode),
				zap.String("path", backendPath),
				zap.String("method", c.Request.Method))
		}

		for name, values := range resp.Header {
			for _, value := range values {
				c.Writer.Header().Add(name, value)
			}
		}
		c.Status(resp.StatusCode)
		_, _ = io.Copy(c.Writer, resp.Body)
	}
}
