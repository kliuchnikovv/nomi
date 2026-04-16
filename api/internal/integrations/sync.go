package integrations

import (
	"encoding/json"
	"fmt"

	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

// SyncIntegration synchronizes an integration between client and server
// Returns true if the integration should be synced
func SyncIntegration(integration *storage.Integration, logger *zap.Logger) (bool, error) {
	// Check if sync is required for this provider
	if !ShouldSync(integration.Provider) {
		logger.Debug("integration does not require sync",
			zap.String("provider", integration.Provider),
		)
		return false, nil
	}

	// Validate integration data
	if err := ValidateIntegration(integration); err != nil {
		return false, fmt.Errorf("integration validation failed: %w", err)
	}

	logger.Info("integration requires sync",
		zap.String("provider", integration.Provider),
		zap.String("integration_id", integration.ID.String()),
	)

	return true, nil
}

// ValidateIntegration checks integration data validity
func ValidateIntegration(integration *storage.Integration) error {
	if integration.Provider == "" {
		return fmt.Errorf("provider is required")
	}

	// Check if the provider exists in the registry
	provider, ok := GetProvider(integration.Provider)
	if !ok {
		return fmt.Errorf("provider %s not found in registry", integration.Provider)
	}

	// For OAuth providers, check for required parameters
	if provider.OAuthConfig != nil {
		if integration.Params == "" {
			return fmt.Errorf("params are required for OAuth provider %s", integration.Provider)
		}

		// Verify that Params is valid JSON
		var params map[string]interface{}
		if err := json.Unmarshal([]byte(integration.Params), &params); err != nil {
			return fmt.Errorf("invalid JSON in params: %w", err)
		}

		// Check for required OAuth fields
		if accessToken, ok := params["access_token"]; !ok || accessToken == "" {
			return fmt.Errorf("access_token is required for OAuth provider %s", integration.Provider)
		}
	}

	return nil
}

// ConvertIntegrationToClientFormat converts a server integration to client format
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

	// Parse parameters
	if integration.Params != "" {
		var params map[string]interface{}
		if err := json.Unmarshal([]byte(integration.Params), &params); err != nil {
			return nil, fmt.Errorf("failed to parse params: %w", err)
		}

		// Add registry metadata
		result["storage_type"] = string(provider.StorageType)
		result["supports_background_tasks"] = provider.SupportsBackgroundTasks
		result["system_event_listeners"] = provider.SystemEventListeners
		result["description"] = provider.Description
		result["icon"] = provider.Icon

		// For client-only integrations, don't send tokens
		if provider.StorageType == StorageTypeClientOnly {
			// Remove sensitive data
			delete(params, "access_token")
			delete(params, "refresh_token")
			delete(params, "client_secret")
		}

		result["params"] = params
	}

	return result, nil
}

// ConvertClientIntegrationToServerFormat converts a client integration to server format
func ConvertClientIntegrationToServerFormat(clientData map[string]interface{}) (*storage.Integration, error) {
	providerName, ok := clientData["provider"].(string)
	if !ok || providerName == "" {
		return nil, fmt.Errorf("provider is required")
	}

	provider, ok := GetProvider(providerName)
	if !ok {
		return nil, fmt.Errorf("provider %s not found in registry", providerName)
	}

	// For client-only integrations, don't save on server
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

	// Convert parameters
	if params, ok := clientData["params"].(map[string]interface{}); ok {
		paramsJSON, err := json.Marshal(params)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal params: %w", err)
		}
		integration.Params = string(paramsJSON)
	}

	return integration, nil
}

// FilterIntegrationsForSync filters integrations that should be synced
func FilterIntegrationsForSync(integrations []storage.Integration) []storage.Integration {
	var result []storage.Integration

	for _, integration := range integrations {
		if ShouldSync(integration.Provider) {
			result = append(result, integration)
		}
	}

	return result
}
