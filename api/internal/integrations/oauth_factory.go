package integrations

import (
	"context"
	"fmt"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
)

// OAuthFactory создает OAuth конфигурации из реестра провайдеров
type OAuthFactory struct {
	cfg          *config.Config
	logger       *zap.Logger
	oidcProviders map[string]*oidc.Provider
}

// NewOAuthFactory создает новую фабрику OAuth конфигураций
func NewOAuthFactory(cfg *config.Config, logger *zap.Logger) (*OAuthFactory, error) {
	factory := &OAuthFactory{
		cfg:           cfg,
		logger:        logger,
		oidcProviders: make(map[string]*oidc.Provider),
	}

	// Инициализируем OIDC провайдеры для провайдеров, которые их используют
	for name, provider := range Registry {
		if provider.OAuthConfig != nil && provider.OAuthConfig.IsOIDC && provider.OAuthConfig.IssuerURL != "" {
			// Проверяем, не создали ли мы уже провайдер для этого issuer
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

	// Получаем базовую конфигурацию OAuth из config
	var baseCfg struct {
		ClientID     string
		ClientSecret string
		RedirectURL  string
		IssuerURL    string
		Scopes       []string
	}

	switch providerName {
	case "gmail", "calendar":
		cfg, exists := f.cfg.OAuth2.Providers["google"]
		if !exists {
			return nil, fmt.Errorf("google provider config not found")
		}
		baseCfg.ClientID = cfg.ClientID
		baseCfg.ClientSecret = cfg.ClientSecret
		baseCfg.RedirectURL = cfg.RedirectURL
		baseCfg.IssuerURL = cfg.IssuerURL
		baseCfg.Scopes = cfg.Scopes
	case "github":
		cfg, exists := f.cfg.OAuth2.Providers["github"]
		if !exists {
			return nil, fmt.Errorf("github provider config not found")
		}
		baseCfg.ClientID = cfg.ClientID
		baseCfg.ClientSecret = cfg.ClientSecret
		baseCfg.RedirectURL = cfg.RedirectURL
		baseCfg.IssuerURL = cfg.IssuerURL
		baseCfg.Scopes = cfg.Scopes
	default:
		return nil, fmt.Errorf("unsupported provider for OAuth: %s", providerName)
	}

	// Генерируем redirect URL
	redirectURL := fmt.Sprintf("%s/api/oauth/%s/callback", f.cfg.OAuth2.CallbackBase, providerName)

	// Получаем scopes
	var scopes []string
	if provider.OAuthConfig.GetScopes != nil {
		scopes = provider.OAuthConfig.GetScopes(permissions)
	} else {
		scopes = provider.OAuthConfig.Scopes
	}

	// Создаем OAuth конфигурацию
	oauthConfig := &oauth2.Config{
		ClientID:     baseCfg.ClientID,
		ClientSecret: baseCfg.ClientSecret,
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

// BuildOAuthConfigsForProvider создает OAuth конфигурации для всех провайдеров указанного типа
// Например, для "google" создаст конфигурации для gmail и calendar
func (f *OAuthFactory) BuildOAuthConfigsForProvider(baseProviderName string) (map[string]*oauth2.Config, error) {
	configs := make(map[string]*oauth2.Config)

	// Определяем, какие провайдеры относятся к базовому провайдеру
	var providerNames []string
	switch baseProviderName {
	case "google":
		providerNames = []string{"gmail", "calendar"}
	case "github":
		providerNames = []string{"github"}
	default:
		return nil, fmt.Errorf("unsupported base provider: %s", baseProviderName)
	}

	// Создаем конфигурации для каждого провайдера
	for _, providerName := range providerNames {
		var permissions []string
		switch providerName {
		case "gmail":
			permissions = []string{"gmail:read", "gmail:write"}
		case "calendar":
			permissions = []string{"calendar:read", "calendar:write"}
		case "github":
			permissions = []string{} // GitHub использует фиксированные scopes
		}

		config, err := f.BuildOAuthConfig(providerName, permissions)
		if err != nil {
			f.logger.Warn("failed to build OAuth config",
				zap.String("provider", providerName),
				zap.Error(err),
			)
			continue
		}
		configs[providerName] = config
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

		var permissions []string
		switch name {
		case "gmail":
			permissions = []string{"gmail:read", "gmail:write"}
		case "calendar":
			permissions = []string{"calendar:read", "calendar:write"}
		case "github":
			permissions = []string{}
		default:
			permissions = []string{}
		}

		config, err := f.BuildOAuthConfig(name, permissions)
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
