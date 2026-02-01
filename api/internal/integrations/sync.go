package integrations

import (
	"encoding/json"
	"fmt"

	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

// SyncIntegration синхронизирует интеграцию между клиентом и сервером
// Возвращает true, если интеграция должна быть синхронизирована
func SyncIntegration(integration *storage.Integration, logger *zap.Logger) (bool, error) {
	// Проверяем, требуется ли синхронизация для этого провайдера
	if !ShouldSync(integration.Provider) {
		logger.Debug("integration does not require sync",
			zap.String("provider", integration.Provider),
		)
		return false, nil
	}

	// Валидация данных интеграции
	if err := ValidateIntegration(integration); err != nil {
		return false, fmt.Errorf("integration validation failed: %w", err)
	}

	logger.Info("integration requires sync",
		zap.String("provider", integration.Provider),
		zap.String("integration_id", integration.ID.String()),
	)

	return true, nil
}

// ValidateIntegration проверяет корректность данных интеграции
func ValidateIntegration(integration *storage.Integration) error {
	if integration.Provider == "" {
		return fmt.Errorf("provider is required")
	}

	// Проверяем, существует ли провайдер в реестре
	provider, ok := GetProvider(integration.Provider)
	if !ok {
		return fmt.Errorf("provider %s not found in registry", integration.Provider)
	}

	// Для OAuth провайдеров проверяем наличие параметров
	if provider.OAuthConfig != nil {
		if integration.Params == "" {
			return fmt.Errorf("params are required for OAuth provider %s", integration.Provider)
		}

		// Проверяем, что Params - валидный JSON
		var params map[string]interface{}
		if err := json.Unmarshal([]byte(integration.Params), &params); err != nil {
			return fmt.Errorf("invalid JSON in params: %w", err)
		}

		// Проверяем наличие обязательных полей для OAuth
		if accessToken, ok := params["access_token"]; !ok || accessToken == "" {
			return fmt.Errorf("access_token is required for OAuth provider %s", integration.Provider)
		}
	}

	return nil
}

// ConvertIntegrationToClientFormat конвертирует серверную интеграцию в формат для клиента
func ConvertIntegrationToClientFormat(integration *storage.Integration) (map[string]interface{}, error) {
	provider, ok := GetProvider(integration.Provider)
	if !ok {
		return nil, fmt.Errorf("provider %s not found in registry", integration.Provider)
	}

	result := map[string]interface{}{
		"id":       integration.ID.String(),
		"name":     integration.Name,
		"provider": integration.Provider,
		"enabled":  integration.Enabled,
	}

	// Парсим параметры
	if integration.Params != "" {
		var params map[string]interface{}
		if err := json.Unmarshal([]byte(integration.Params), &params); err != nil {
			return nil, fmt.Errorf("failed to parse params: %w", err)
		}

		// Добавляем метаданные из реестра
		result["storage_type"] = string(provider.StorageType)
		result["supports_background_tasks"] = provider.SupportsBackgroundTasks
		result["system_event_listeners"] = provider.SystemEventListeners
		result["description"] = provider.Description
		result["icon"] = provider.Icon

		// Для клиентских интеграций не передаем токены
		if provider.StorageType == StorageTypeClientOnly {
			// Удаляем чувствительные данные
			delete(params, "access_token")
			delete(params, "refresh_token")
			delete(params, "client_secret")
		}

		result["params"] = params
	}

	return result, nil
}

// ConvertClientIntegrationToServerFormat конвертирует клиентскую интеграцию в формат для сервера
func ConvertClientIntegrationToServerFormat(clientData map[string]interface{}) (*storage.Integration, error) {
	providerName, ok := clientData["provider"].(string)
	if !ok || providerName == "" {
		return nil, fmt.Errorf("provider is required")
	}

	provider, ok := GetProvider(providerName)
	if !ok {
		return nil, fmt.Errorf("provider %s not found in registry", providerName)
	}

	// Для клиентских интеграций не сохраняем на сервере
	if provider.StorageType == StorageTypeClientOnly {
		return nil, fmt.Errorf("client-only integrations should not be synced to server")
	}

	integration := &storage.Integration{
		Provider: providerName,
		Enabled:  true,
	}

	if name, ok := clientData["name"].(string); ok {
		integration.Name = name
	}

	// Конвертируем параметры
	if params, ok := clientData["params"].(map[string]interface{}); ok {
		paramsJSON, err := json.Marshal(params)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal params: %w", err)
		}
		integration.Params = string(paramsJSON)
	}

	return integration, nil
}

// FilterIntegrationsForSync фильтрует интеграции, которые должны быть синхронизированы
func FilterIntegrationsForSync(integrations []storage.Integration) []storage.Integration {
	var result []storage.Integration

	for _, integration := range integrations {
		if ShouldSync(integration.Provider) {
			result = append(result, integration)
		}
	}

	return result
}
