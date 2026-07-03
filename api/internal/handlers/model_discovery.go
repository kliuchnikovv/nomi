package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

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
func (h *ModelsHandler) DiscoverModelsHandler(w http.ResponseWriter, r *http.Request) {
	var requestBody struct {
		APIKey   string `json:"api_key"`
		Endpoint string `json:"endpoint"`
		Provider string `json:"provider"`
	}

	if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
		h.Logger.Error("Failed to decode request body", zap.Error(err))
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	models, err := h.discoverModelsFunc(requestBody.APIKey, requestBody.Endpoint, requestBody.Provider)
	if err != nil {
		h.Logger.Error("Failed to discover models", zap.Error(err))

		errStr := err.Error()
		switch {
		case strings.Contains(errStr, "endpoint URL cannot be empty"):
			http.Error(w, errStr, http.StatusBadRequest)
		case strings.Contains(errStr, "API request failed with status 401"):
			http.Error(w, "Unauthorized: Invalid API Key", http.StatusUnauthorized)
		case strings.Contains(errStr, "failed to make HTTP request"):
			http.Error(w, errStr, http.StatusBadRequest)
		case strings.Contains(errStr, "failed to decode OpenAI compatible response"):
			http.Error(w, "Invalid API response from endpoint", http.StatusBadGateway)
		default:
			http.Error(w, "Failed to discover models", http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(models); err != nil {
		h.Logger.Error("Failed to encode models response", zap.Error(err))
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}