package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// Service is responsible for communication with the AgnoProject RAG service.
type Service struct {
	agnoAPIURL string
	httpClient *http.Client
}

// NewService creates a new LlmService instance.
// Make sure to pass the URL from your config.
func NewService(agnoAPIURL string) *Service {
	return &Service{
		agnoAPIURL: agnoAPIURL,
		httpClient: &http.Client{},
	}
}

// GenerateResponse delegates the request to AgnoProject instead of calling LLM directly.
func (s *Service) GenerateResponse(ctx context.Context, userQuery string) (string, error) {
	// 1. Build request body for AgnoProject /query
	requestBody, err := json.Marshal(map[string]string{
		"query": userQuery,
	})
	if err != nil {
		return "", fmt.Errorf("failed to marshal query request: %w", err)
	}

	// 2. Create and send HTTP POST request
	req, err := http.NewRequestWithContext(ctx, "POST", s.agnoAPIURL+"/query", bytes.NewBuffer(requestBody))
	if err != nil {
		return "", fmt.Errorf("failed to create request for agno query: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to call agno query endpoint: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Try to read the error body for better diagnostics
		var errorBody map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&errorBody)
		return "", fmt.Errorf("agno project returned non-200 status: %d, body: %v", resp.StatusCode, errorBody)
	}

	// 3. Decode and return the successful response
	var responseBody struct {
		Answer    string `json:"answer"`
		Reasoning string `json:"reasoning,omitempty"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&responseBody); err != nil {
		return "", fmt.Errorf("failed to decode agno response: %w", err)
	}

	// We append reasoning if available
	if responseBody.Reasoning != "" {
		return responseBody.Answer + "\n\n<thinking>\n" + responseBody.Reasoning + "\n</thinking>", nil
	}
	return responseBody.Answer, nil
}
