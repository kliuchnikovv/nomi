package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/google/uuid"
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

// GenerateSimple is a simplified wrapper around GenerateResponse for plugin compatibility.
// The userID and agent parameters are currently unused but kept for interface compatibility.
func (s *Service) GenerateSimple(ctx context.Context, userID uuid.UUID, prompt string, agent string) (string, error) {
	return s.GenerateResponse(ctx, prompt)
}

// GetBriefing calls the /api/briefing endpoint on the Python backend.
func (s *Service) GetBriefing(ctx context.Context, userID string, contextData map[string]interface{}) (map[string]interface{}, error) {
	requestBody, err := json.Marshal(map[string]interface{}{
		"user_id": userID,
		"context": contextData,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal briefing request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", s.agnoAPIURL+"/api/briefing", bytes.NewBuffer(requestBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request for briefing: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to call briefing endpoint: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errorBody map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&errorBody)
		return nil, fmt.Errorf("briefing endpoint returned non-200 status: %d, body: %v", resp.StatusCode, errorBody)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode briefing response: %w", err)
	}
	return result, nil
}

// EmailAnalysisRequest represents the request body for email analysis.
type EmailAnalysisRequest struct {
	EmailID   string `json:"email_id"`
	Subject   string `json:"subject,omitempty"`
	FromEmail string `json:"from_email,omitempty"`
	FromName  string `json:"from_name,omitempty"`
	Body      string `json:"body"`
	Date      string `json:"date,omitempty"`
}

// AnalyzeEmail calls the /api/analyze-email endpoint on the Python backend.
func (s *Service) AnalyzeEmail(ctx context.Context, req EmailAnalysisRequest) (map[string]interface{}, error) {
	requestBody, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal email analysis request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", s.agnoAPIURL+"/api/analyze-email", bytes.NewBuffer(requestBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request for email analysis: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to call email analysis endpoint: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errorBody map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&errorBody)
		return nil, fmt.Errorf("email analysis endpoint returned non-200 status: %d, body: %v", resp.StatusCode, errorBody)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode email analysis response: %w", err)
	}
	return result, nil
}
