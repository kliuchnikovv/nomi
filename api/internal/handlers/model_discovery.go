package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// DiscoverModels fetches models from a given endpoint and API key.
func DiscoverModels(apiKey, endpoint, provider string) ([]Model, error) {
	if endpoint == "" {
		return nil, fmt.Errorf("endpoint URL cannot be empty")
	}

	req, err := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/v1/models", endpoint), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make HTTP request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API request failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var openAIResponse struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&openAIResponse); err != nil {
		return nil, fmt.Errorf("failed to decode OpenAI compatible response: %w", err)
	}

	var models []Model
	for _, data := range openAIResponse.Data {
		models = append(models, Model{ID: data.ID, Provider: provider})
	}

	return models, nil
}

// DiscoverModelsHandler handles the model discovery API request.
func (h *ModelsHandler) DiscoverModelsHandler(c *gin.Context) {
	var requestBody struct {
		APIKey   string `json:"api_key"`
		Endpoint string `json:"endpoint"`
		Provider string `json:"provider"`
	}

	if err := c.ShouldBindJSON(&requestBody); err != nil {
		h.Logger.Error("Failed to decode request body", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	models, err := h.discoverModelsFunc(requestBody.APIKey, requestBody.Endpoint, requestBody.Provider)
	if err != nil {
		h.Logger.Error("Failed to discover models", zap.Error(err))

		errStr := err.Error()
		switch {
		case strings.Contains(errStr, "endpoint URL cannot be empty"):
			c.JSON(http.StatusBadRequest, gin.H{"error": errStr})
		case strings.Contains(errStr, "API request failed with status 401"):
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized: Invalid API Key"})
		case strings.Contains(errStr, "failed to make HTTP request"):
			c.JSON(http.StatusBadRequest, gin.H{"error": errStr})
		case strings.Contains(errStr, "failed to decode OpenAI compatible response"):
			c.JSON(http.StatusBadGateway, gin.H{"error": "Invalid API response from endpoint"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to discover models"})
		}
		return
	}

	c.JSON(http.StatusOK, models)
}