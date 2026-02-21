package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
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

		logger.Debug("Proxying embeddings request",
			zap.String("target_url", targetURL+"/embeddings"),
			zap.String("method", c.Request.Method))

		proxyReq, err := http.NewRequest(c.Request.Method, targetURL+"/embeddings", c.Request.Body)
		if err != nil {
			logger.Error("Failed to create proxy request", zap.Error(err))
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
			logger.Error("Failed to proxy embeddings request",
				zap.Error(err),
				zap.String("target_url", targetURL+"/embeddings"))
			c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to contact AI service"})
			return
		}
		defer resp.Body.Close()

		logger.Info("Embeddings response received",
			zap.Int("status_code", resp.StatusCode))

		// Log warnings for non-2xx responses to make them more visible
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			logger.Warn("Embeddings request returned non-success status",
				zap.Int("status_code", resp.StatusCode))
			bodyBytes, readErr := io.ReadAll(resp.Body)
			if readErr != nil {
				logger.Error("Failed to read error response body", zap.Error(readErr))
			} else {
				logger.Warn("Embeddings error response",
					zap.String("body", string(bodyBytes)))
			}
			c.JSON(resp.StatusCode, gin.H{"error": fmt.Sprintf("AI service returned status %d", resp.StatusCode)})
			return
		}

		for name, values := range resp.Header {
			for _, value := range values {
				c.Writer.Header().Add(name, value)
			}
		}
		c.Status(resp.StatusCode)

		bytesWritten, err := io.Copy(c.Writer, resp.Body)
		if err != nil {
			logger.Error("Failed to copy response body",
				zap.Error(err),
				zap.Int64("bytes_written", bytesWritten))
		} else {
			logger.Debug("Successfully proxied embeddings response",
				zap.Int64("bytes", bytesWritten))
		}
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

		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			logger.Error("Failed to read response body", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read response"})
			return
		}

		// Log warnings for non-2xx responses to make them more visible
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			logger.Warn("GitHub repos request returned non-success status",
				zap.Int("status_code", resp.StatusCode),
				zap.String("response_body", string(bodyBytes)))

			// Try to parse as JSON, if not, return a generic error
			if !isValidJSON(bodyBytes) {
				c.JSON(resp.StatusCode, gin.H{
					"error":   fmt.Sprintf("AI service returned status %d", resp.StatusCode),
					"details": string(bodyBytes),
				})
				return
			}
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

// ProxyPlugins forwards requests to Python plugin endpoints for all plugins.
// Generic route: /api/{plugin}/*path -> /api/plugins/{plugin}/*path
func ProxyPlugins(cfg *config.Config, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Extract plugin name and path from URL
		// /api/github/repos -> plugin="github", path="repos"
		// /api/telegram/messages -> plugin="telegram", path="messages"
		path := c.Param("path")
		if path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Plugin path is required"})
			return
		}

		// Split path into plugin name and resource path
		parts := strings.Split(path, "/")
		if len(parts) < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid plugin path"})
			return
		}

		pluginName := parts[0]
		resourcePath := strings.Join(parts[1:], "/")

		targetURL := cfg.LLM.BaseURL
		if targetURL == "" {
			targetURL = "http://127.0.0.1:7777"
		}

		// Build backend path: /api/plugins/{plugin}/{resource}
		backendPath := fmt.Sprintf("/api/plugins/%s/%s", pluginName, resourcePath)

		logger.Debug("Proxying plugin request",
			zap.String("plugin", pluginName),
			zap.String("resource_path", resourcePath),
			zap.String("backend_path", backendPath),
			zap.String("method", c.Request.Method))

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

		// Inject authenticated user ID so Python plugin can identify user
		if userID, exists := c.Get("userID"); exists {
			proxyReq.Header.Set("X-User-ID", fmt.Sprintf("%v", userID))
		}

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(proxyReq)
		if err != nil {
			logger.Error("Failed to proxy plugin request", zap.Error(err),
				zap.String("plugin", pluginName),
				zap.String("path", resourcePath))
			c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to contact plugin service"})
			return
		}
		defer resp.Body.Close()

		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			logger.Error("Failed to read response body", zap.Error(err),
				zap.String("plugin", pluginName),
				zap.String("path", resourcePath))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read response"})
			return
		}

		// Log warnings for non-2xx responses to make them more visible
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			logger.Warn("Plugin request returned non-success status",
				zap.Int("status_code", resp.StatusCode),
				zap.String("plugin", pluginName),
				zap.String("path", resourcePath),
				zap.String("method", c.Request.Method),
				zap.String("response_body", string(bodyBytes)))

			// Try to parse as JSON, if not, return a generic error
			if !isValidJSON(bodyBytes) {
				c.JSON(resp.StatusCode, gin.H{
					"error":   fmt.Sprintf("Plugin service returned status %d", resp.StatusCode),
					"details": string(bodyBytes),
				})
				return
			}
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

func isValidJSON(data []byte) bool {
	var js map[string]interface{}
	return json.Unmarshal(data, &js) == nil
}

// ProxyWebhooks forwards public webhook requests to Python plugins (no auth).
// Route: /api/webhooks/{plugin}/*path -> /api/plugins/{plugin}/webhook/*path
func ProxyWebhooks(cfg *config.Config, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Extract plugin name and path from URL
		// /api/webhooks/telegram -> plugin="telegram", path="webhook"
		path := c.Param("path")
		if path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Webhook path is required"})
			return
		}

		// Split path into plugin name and resource path
		parts := strings.Split(path, "/")
		if len(parts) < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook path"})
			return
		}

		pluginName := parts[0]
		resourcePath := strings.Join(parts[1:], "/")

		targetURL := cfg.LLM.BaseURL
		if targetURL == "" {
			targetURL = "http://127.0.0.1:7777"
		}

		// Build backend path: /api/plugins/{plugin}/{resource}
		backendPath := fmt.Sprintf("/api/plugins/%s/%s", pluginName, resourcePath)

		logger.Debug("Proxying webhook request",
			zap.String("plugin", pluginName),
			zap.String("resource_path", resourcePath),
			zap.String("backend_path", backendPath),
			zap.String("method", c.Request.Method))

		proxyReq, err := http.NewRequest(c.Request.Method, targetURL+backendPath, c.Request.Body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create proxy request"})
			return
		}

		// Copy all headers except auth (webhooks are public)
		for name, values := range c.Request.Header {
			if name != "Authorization" {
				for _, value := range values {
					proxyReq.Header.Add(name, value)
				}
			}
		}

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(proxyReq)
		if err != nil {
			logger.Error("Failed to proxy webhook request", zap.Error(err),
				zap.String("plugin", pluginName),
				zap.String("path", resourcePath))
			c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to contact plugin service"})
			return
		}
		defer resp.Body.Close()

		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			logger.Error("Failed to read response body", zap.Error(err),
				zap.String("plugin", pluginName),
				zap.String("path", resourcePath))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read response"})
			return
		}

		// Log warnings for non-2xx responses to make them more visible
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			logger.Warn("Webhook request returned non-success status",
				zap.Int("status_code", resp.StatusCode),
				zap.String("plugin", pluginName),
				zap.String("path", resourcePath),
				zap.String("method", c.Request.Method),
				zap.String("response_body", string(bodyBytes)))

			// Try to parse as JSON, if not, return a generic error
			if !isValidJSON(bodyBytes) {
				c.JSON(resp.StatusCode, gin.H{
					"error":   fmt.Sprintf("Plugin service returned status %d", resp.StatusCode),
					"details": string(bodyBytes),
				})
				return
			}
		}

		// Copy response headers
		for name, values := range resp.Header {
			for _, value := range values {
				c.Writer.Header().Add(name, value)
			}
		}
		c.Status(resp.StatusCode)
		_, _ = c.Writer.Write(bodyBytes)
	}
}
