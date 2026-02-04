package integrations

import (
	"context"
	"fmt"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
	"strings"
)

// OAuthFactory создает OAuth конфигурации из реестра провайдеров (загруженных из манифестов плагинов)
type OAuthFactory struct {
	cfg           *config.Config
	logger        *zap.Logger
	oidcProviders map[string]*oidc.Provider
}

// NewOAuthFactory создает новую фабрику OAuth конфигураций
func NewOAuthFactory(cfg *config.Config, logger *zap.Logger) (*OAuthFactory, error) {
	factory := &OAuthFactory{
		cfg:           cfg,
		logger:        logger,
		oidcProviders: make(map[string]*oidc.Provider),
	}

	for name, provider := range Registry {
		if provider.OAuthConfig != nil && provider.OAuthConfig.IsOIDC && provider.OAuthConfig.IssuerURL != "" {
			if _, exists := factory.oidcProviders[provider.OAuthConfig.IssuerURL]; !exists {
				oidcProvider, err := oidc.NewProvider(context.Background(), provider.OAuthConfig.IssuerURL)
				if err != nil {
					return nil, fmt.Errorf("failed to create OIDC provider for %s: %w", name, err)
				}
				factory.oidcProviders[provider.OAuthConfig.IssuerURL] = oidcProvider
				logger.Info("initialized OIDC provider", zap.String("issuer", provider.OAuthConfig.IssuerURL))
			}
		}
	}

	// Fallback: create OIDC providers from config when Registry is empty (e.g. plugins dir missing in Docker)
	for key, prov := range cfg.OAuth2.Providers {
		if prov.IssuerURL == "" {
			continue
		}
		if _, exists := factory.oidcProviders[prov.IssuerURL]; exists {
			continue
		}
		oidcProvider, err := oidc.NewProvider(context.Background(), prov.IssuerURL)
		if err != nil {
			logger.Warn("failed to create OIDC provider from config", zap.String("config_key", key), zap.String("issuer", prov.IssuerURL), zap.Error(err))
			continue
		}
		factory.oidcProviders[prov.IssuerURL] = oidcProvider
		logger.Info("initialized OIDC provider from config", zap.String("config_key", key), zap.String("issuer", prov.IssuerURL))
	}

	return factory, nil
}

// BuildOAuthConfig создает OAuth конфигурацию для указанного провайдера
func (f *OAuthFactory) BuildOAuthConfig(providerName string, permissions []string) (*oauth2.Config, error) {
	provider, ok := GetProvider(providerName)
	if !ok {
		return nil, fmt.Errorf("provider %s not found in registry", providerName)
	}

	if provider.OAuthConfig == nil {
		return nil, fmt.Errorf("provider %s does not support OAuth", providerName)
	}

	if provider.OAuthConfigKey == "" {
		return nil, fmt.Errorf("provider %s has no oauth_config_key", providerName)
	}

	cfg, exists := f.cfg.OAuth2.Providers[provider.OAuthConfigKey]
	if !exists {
		return nil, fmt.Errorf("oauth config key %s not found in config", provider.OAuthConfigKey)
	}

	callbackBase := strings.TrimSuffix(f.cfg.OAuth2.CallbackBase, "/")
	redirectURL := fmt.Sprintf("%s/api/oauth/%s/callback", callbackBase, providerName)

	var scopes []string
	if provider.OAuthConfig.GetScopes != nil {
		if len(permissions) == 0 {
			permissions = provider.DefaultPermissions
		}
		scopes = provider.OAuthConfig.GetScopes(permissions)
	} else {
		scopes = provider.OAuthConfig.Scopes
	}

	oauthConfig := &oauth2.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		RedirectURL:  redirectURL,
		Scopes:       scopes,
		Endpoint:     provider.OAuthConfig.Endpoint,
	}

	f.logger.Info("built OAuth config from registry",
		zap.String("provider", providerName),
		zap.String("redirect_url", redirectURL),
		zap.Int("scopes_count", len(scopes)),
	)

	return oauthConfig, nil
}

// GetOIDCProvider возвращает OIDC провайдер для указанного issuer URL
func (f *OAuthFactory) GetOIDCProvider(issuerURL string) (*oidc.Provider, error) {
	provider, ok := f.oidcProviders[issuerURL]
	if !ok {
		return nil, fmt.Errorf("OIDC provider for issuer %s not found", issuerURL)
	}
	return provider, nil
}

// BuildOAuthConfigsForProvider создает OAuth конфигурации для всех провайдеров с указанным oauth_config_key
func (f *OAuthFactory) BuildOAuthConfigsForProvider(baseProviderName string) (map[string]*oauth2.Config, error) {
	configs := make(map[string]*oauth2.Config)

	for name, provider := range Registry {
		if provider.OAuthConfig == nil || provider.OAuthConfigKey != baseProviderName {
			continue
		}
		config, err := f.BuildOAuthConfig(name, provider.DefaultPermissions)
		if err != nil {
			f.logger.Warn("failed to build OAuth config",
				zap.String("provider", name),
				zap.Error(err),
			)
			continue
		}
		configs[name] = config
	}

	return configs, nil
}

// BuildAllOAuthConfigs создает OAuth конфигурации для всех провайдеров в реестре
func (f *OAuthFactory) BuildAllOAuthConfigs() (map[string]*oauth2.Config, error) {
	configs := make(map[string]*oauth2.Config)

	for name, provider := range Registry {
		if provider.OAuthConfig == nil {
			continue
		}
		config, err := f.BuildOAuthConfig(name, provider.DefaultPermissions)
		if err != nil {
			f.logger.Warn("failed to build OAuth config",
				zap.String("provider", name),
				zap.Error(err),
			)
			continue
		}
		configs[name] = config
	}

	return configs, nil
}
