package handlers

import (
	"context"
	"fmt"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
)

// BuildOAuthResources constructs OAuth2 configs and OIDC providers from the app config.
func BuildOAuthResources(logger *zap.Logger, cfg *config.Config) (map[string]*oauth2.Config, map[string]*oidc.Provider, error) {
	if len(cfg.OAuth2.Providers) == 0 {
		return nil, nil, fmt.Errorf("no oauth providers configured")
	}

	oauthConfigs := make(map[string]*oauth2.Config)
	oidcProviders := make(map[string]*oidc.Provider)
	for name, providerCfg := range cfg.OAuth2.Providers {
		provider, err := oidc.NewProvider(context.Background(), providerCfg.IssuerURL)
		if err != nil {
			return nil, nil, err
		}
		oidcProviders[name] = provider
		redirect := providerCfg.RedirectURL
		if redirect == "" {
			if cfg.OAuth2.CallbackBase == "" {
				return nil, nil, fmt.Errorf("redirect_url missing for provider %s and callback_base unset", name)
			}
			base := strings.TrimSuffix(cfg.OAuth2.CallbackBase, "/")
			redirect = fmt.Sprintf("%s/api/oauth/%s/callback", base, name)
		}
		logger.Info("redirect url", zap.String("provider", name), zap.String("url", redirect))
		oauthConfigs[name] = &oauth2.Config{
			ClientID:     providerCfg.ClientID,
			ClientSecret: providerCfg.ClientSecret,
			RedirectURL:  redirect,
			Scopes:       providerCfg.Scopes,
			Endpoint:     provider.Endpoint(),
		}
	}

	return oauthConfigs, oidcProviders, nil
}
