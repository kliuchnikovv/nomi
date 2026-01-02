package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/google/uuid"
)

// Service теперь отвечает за коммуникацию с AgnoProject RAG-сервисом.
type Service struct {
	agnoAPIURL string
	httpClient *http.Client
}

// NewService создает новый экземпляр LlmService.
// Убедитесь, что вы передаете сюда URL из вашего конфига.
func NewService(agnoAPIURL string) *Service {
	return &Service{
		agnoAPIURL: agnoAPIURL,
		httpClient: &http.Client{},
	}
}

// GenerateResponse теперь не обращается напрямую к LLM,
// а делегирует запрос AgnoProject.
func (s *Service) GenerateResponse(ctx context.Context, userQuery string) (string, error) {
	// 1. Формируем тело запроса к AgnoProject /query
	requestBody, err := json.Marshal(map[string]string{
		"query": userQuery,
	})
	if err != nil {
		return "", fmt.Errorf("failed to marshal query request: %w", err)
	}

	// 2. Создаем и отправляем HTTP POST-запрос
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
		// Попытаемся прочитать тело ошибки для лучшей диагностики
		var errorBody map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&errorBody)
		return "", fmt.Errorf("agno project returned non-200 status: %d, body: %v", resp.StatusCode, errorBody)
	}

	// 3. Декодируем и возвращаем успешный ответ
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
func (s *Service) GetBriefing(ctx context.Context, userID string) (map[string]interface{}, error) {
	requestBody, err := json.Marshal(map[string]string{
		"user_id": userID,
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
