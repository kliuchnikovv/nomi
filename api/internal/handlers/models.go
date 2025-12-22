package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"sync"

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
}

type ModelsResponse struct {
	Models []Model `json:"models"`
}

type ModelsHandler struct {
	modelsCache *ModelsResponse
	mu          sync.RWMutex
	configPath  string
}

func NewModelsHandler(configPath string) *ModelsHandler {
	return &ModelsHandler{
		configPath: configPath,
	}
}

// loadModels loads models from JSON file with caching
func (h *ModelsHandler) loadModels() (*ModelsResponse, error) {
	h.mu.RLock()
	if h.modelsCache != nil {
		defer h.mu.RUnlock()
		return h.modelsCache, nil
	}
	h.mu.RUnlock()

	h.mu.Lock()
	defer h.mu.Unlock()

	// Double-check after acquiring write lock
	if h.modelsCache != nil {
		return h.modelsCache, nil
	}

	data, err := os.ReadFile(h.configPath)
	if err != nil {
		return nil, err
	}

	var response ModelsResponse
	if err := json.Unmarshal(data, &response); err != nil {
		return nil, err
	}

	h.modelsCache = &response
	return h.modelsCache, nil
}

// ListModels returns the list of available models
// @Summary List available models
// @Description Get list of all available LLM models
// @Tags models
// @Produce json
// @Success 200 {object} ModelsResponse
// @Failure 500 {object} map[string]string
// @Router /api/models [get]
func (h *ModelsHandler) ListModels(c *gin.Context) {
	models, err := h.loadModels()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load models configuration"})
		return
	}

	c.JSON(http.StatusOK, models)
}
