package handlers

import (
	"fmt"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/integrations"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
)

// BuildOAuthResources constructs OAuth2 configs and OIDC providers from the app config.
// For OIDC providers (with IssuerURL), it creates both OAuth2 config and OIDC provider.
// For non-OIDC providers (like GitHub), it only creates OAuth2 config.
// Теперь использует OAuth фабрику из реестра интеграций.
func BuildOAuthResources(logger *zap.Logger, cfg *config.Config) (map[string]*oauth2.Config, map[string]*oidc.Provider, error) {
	if len(cfg.OAuth2.Providers) == 0 {
		return nil, nil, fmt.Errorf("no oauth providers configured")
	}

	// Создаем OAuth фабрику из реестра
	oauthFactory, err := integrations.NewOAuthFactory(cfg, logger)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create OAuth factory: %w", err)
	}

	oauthConfigs := make(map[string]*oauth2.Config)
	oidcProviders := make(map[string]*oidc.Provider)

	// Создаем конфигурации для всех провайдеров из реестра
	allConfigs, err := oauthFactory.BuildAllOAuthConfigs()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to build OAuth configs: %w", err)
	}

	// Маппим конфигурации по базовым именам провайдеров (google, github)
	for providerName, oauthConfig := range allConfigs {
		// Определяем базовое имя провайдера для маппинга
		var baseName string
		switch providerName {
		case "gmail", "calendar":
			baseName = "google"
		case "github":
			baseName = "github"
		default:
			logger.Warn("unknown provider in registry, skipping", zap.String("provider", providerName))
			continue
		}

		// Если конфигурация для базового провайдера еще не создана, создаем её
		if _, exists := oauthConfigs[baseName]; !exists {
			oauthConfigs[baseName] = oauthConfig
			logger.Info("configured oauth provider from registry",
				zap.String("base_provider", baseName),
				zap.String("integration", providerName),
			)
		}

		// Для OIDC провайдеров получаем OIDC provider
		provider, ok := integrations.GetProvider(providerName)
		if ok && provider.OAuthConfig != nil && provider.OAuthConfig.IsOIDC {
			oidcProvider, err := oauthFactory.GetOIDCProvider(provider.OAuthConfig.IssuerURL)
			if err == nil {
				oidcProviders[baseName] = oidcProvider
			}
		}
	}

	// Также создаем конфигурации для провайдеров, которые есть в config, но могут отсутствовать в реестре
	// (для обратной совместимости)
	for name := range cfg.OAuth2.Providers {
		if _, exists := oauthConfigs[name]; exists {
			continue // Уже создана из реестра
		}

		// Пытаемся создать из реестра
		provider, ok := integrations.GetProvider(name)
		if ok && provider.OAuthConfig != nil {
			var permissions []string
			config, err := oauthFactory.BuildOAuthConfig(name, permissions)
			if err == nil {
				oauthConfigs[name] = config
				logger.Info("configured oauth provider from registry",
					zap.String("provider", name),
				)
				continue
			}
		}

		// Fallback для провайдеров, которых нет в реестре (обратная совместимость)
		logger.Warn("provider not found in registry, using legacy configuration",
			zap.String("provider", name),
		)
		// Здесь можно добавить legacy логику, если нужно
	}

	return oauthConfigs, oidcProviders, nil
}
