package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type Model struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Provider          string `json:"provider"`
	Description       string `json:"description"`
	ContextWindow     int    `json:"context_window"`
	MaxOutputTokens   int    `json:"max_output_tokens"`
	RPMLimit          int    `json:"rpm_limit"`
	SupportsStreaming bool   `json:"supports_streaming"`
	SupportsTools     bool   `json:"supports_tools"`
	SupportsThinking  bool   `json:"supports_thinking"`
	Streaming         bool   `json:"streaming"` // if true, do not persist text chunks; only DONE overwrite
	Endpoint          string `json:"endpoint,omitempty"`
}

type ModelsResponse struct {
	Models []Model `json:"models"`
}

type GoogleModel struct {
	Name                       string   `json:"name"`
	DisplayName                string   `json:"displayName"`
	Description                string   `json:"description"`
	InputTokenLimit            int      `json:"inputTokenLimit"`
	OutputTokenLimit           int      `json:"outputTokenLimit"`
	SupportedGenerationMethods []string `json:"supportedGenerationMethods"`
}

type GoogleModelsListResponse struct {
	Models []GoogleModel `json:"models"`
}

type ModelsHandler struct {
	apiKey      string
	modelsCache *ModelsResponse
	lastUpdated time.Time
	mu          sync.RWMutex
}

func NewModelsHandler(apiKey string) *ModelsHandler {
	return &ModelsHandler{
		apiKey: apiKey,
	}
}

// loadModels reads models from local config file
func (h *ModelsHandler) loadModels() (*ModelsResponse, error) {
	h.mu.RLock()
	// Cache for 1 hour (though file read is fast, we can keep caching)
	if h.modelsCache != nil && time.Since(h.lastUpdated) < 1*time.Hour {
		defer h.mu.RUnlock()
		return h.modelsCache, nil
	}
	h.mu.RUnlock()

	h.mu.Lock()
	defer h.mu.Unlock()

	// Double-check
	if h.modelsCache != nil && time.Since(h.lastUpdated) < 1*time.Hour {
		return h.modelsCache, nil
	}

	// Try config/models.json (repo root or Docker), then api/config/models.json (legacy)
	file, err := os.Open("config/models.json")
	if err != nil {
		file, err = os.Open("api/config/models.json")
		if err != nil {
			return nil, fmt.Errorf("failed to open models config: %w", err)
		}
	}
	defer file.Close()

	var response ModelsResponse
	if err := json.NewDecoder(file).Decode(&response); err != nil {
		return nil, fmt.Errorf("failed to decode models config: %w", err)
	}

	h.modelsCache = &response
	h.lastUpdated = time.Now()
	return h.modelsCache, nil
}

// ListModels returns the list of available models
// @Summary List available models
// @Description Get list of all available LLM models from configuration
// @Tags models
// @Produce json
// @Success 200 {object} ModelsResponse
// @Failure 500 {object} map[string]string
// @Router /api/models [get]
func (h *ModelsHandler) ListModels(c *gin.Context) {
	models, err := h.loadModels()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to load models: %v", err)})
		return
	}

	c.JSON(http.StatusOK, models)
}
