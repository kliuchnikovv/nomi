package handlers

import (
	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/kliuchnikovv/nomi-api/internal/config"
	"github.com/kliuchnikovv/nomi-api/internal/integrations"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
)

// BuildOAuthResources initializes OAuth configurations and OIDC providers for all supported providers.
// This function is called during server initialization to set up OAuth infrastructure.
func BuildOAuthResources(logger *zap.Logger, cfg *config.Config) (map[string]*oauth2.Config, map[string]*oidc.Provider, error) {
	oauthFactory, err := integrations.NewOAuthFactory(cfg, logger)
	if err != nil {
		return nil, nil, err
	}

	// Build all OAuth configs
	oauthConfigs, err := oauthFactory.BuildAllOAuthConfigs()
	if err != nil {
		return nil, nil, err
	}

	// Build OIDC providers map
	oidcProviders := make(map[string]*oidc.Provider)
	for name, provider := range integrations.Registry {
		if provider.OAuthConfig == nil || !provider.OAuthConfig.IsOIDC || provider.OAuthConfig.IssuerURL == "" {
			continue
		}

		oidcProvider, err := oauthFactory.GetOIDCProvider(provider.OAuthConfig.IssuerURL)
		if err != nil {
			logger.Warn("failed to get OIDC provider",
				zap.String("provider", name),
				zap.Error(err))
			continue
		}
		oidcProviders[name] = oidcProvider
	}

	return oauthConfigs, oidcProviders, nil
}
