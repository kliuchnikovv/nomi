package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
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

// loadModels fetch models from Google API with caching
func (h *ModelsHandler) loadModels() (*ModelsResponse, error) {
	h.mu.RLock()
	// Cache for 1 hour
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

	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models?key=%s", h.apiKey)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("google api error: %s %s", resp.Status, string(body))
	}

	var googleResp GoogleModelsListResponse
	if err := json.NewDecoder(resp.Body).Decode(&googleResp); err != nil {
		return nil, err
	}

	var models []Model
	for _, gm := range googleResp.Models {
		// Filter only models that support content generation
		isGenerative := false
		for _, method := range gm.SupportedGenerationMethods {
			if method == "generateContent" {
				isGenerative = true
				break
			}
		}
		if !isGenerative {
			continue
		}

		// Clean ID (remove "models/" prefix)
		id := strings.TrimPrefix(gm.Name, "models/")

		models = append(models, Model{
			ID:                id,
			Name:              gm.DisplayName,
			Provider:          "google",
			Description:       gm.Description,
			ContextWindow:     gm.InputTokenLimit,
			MaxOutputTokens:   gm.OutputTokenLimit,
			RPMLimit:          0, // API doesn't allow fetching this dynamically per key easily without quotas API
			SupportsStreaming: true,
			SupportsTools:     true, // Most Gemini models support tools
			SupportsThinking:  strings.Contains(strings.ToLower(gm.DisplayName), "thinking") || strings.Contains(id, "thinking"),
		})
	}

	// Sort by Name
	sort.Slice(models, func(i, j int) bool {
		return models[i].Name < models[j].Name
	})

	h.modelsCache = &ModelsResponse{Models: models}
	h.lastUpdated = time.Now()
	return h.modelsCache, nil
}

// ListModels returns the list of available models
// @Summary List available models
// @Description Get list of all available LLM models from Google API
// @Tags models
// @Produce json
// @Success 200 {object} ModelsResponse
// @Failure 500 {object} map[string]string
// @Router /api/models [get]
func (h *ModelsHandler) ListModels(c *gin.Context) {
	models, err := h.loadModels()
	if err != nil {
		// Log error but return typical error response
		// In production, might want to fallback to hardcoded list if API fails
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to fetch models: %v", err)})
		return
	}

	c.JSON(http.StatusOK, models)
}
