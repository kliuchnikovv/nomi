package integrations

import (
	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/kliuchnikovv/genie-api/internal/plugins"
	"github.com/kliuchnikovv/genie-api/internal/providers"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"
	"golang.org/x/oauth2/google"
)

// StorageType defines the storage type for integration data
type StorageType string

const (
	StorageTypeClientOnly StorageType = "client" // Data only in SQLite on device
	StorageTypeServer     StorageType = "server" // Data on server in PostgreSQL
	StorageTypeHybrid     StorageType = "hybrid" // Hybrid storage
)

// ProviderDefinition contains integration provider metadata
type ProviderDefinition struct {
	// Basic metadata
	Name        string      // Provider name (gmail, calendar, github)
	DisplayName string      // Display name
	Type        string      // Integration type (oauth2, api_key, etc.)
	StorageType StorageType // Data storage type

	// OAuth configuration
	OAuthConfig *OAuthConfig

	// OAuthConfigKey is the key in config.OAuth2.Providers (e.g. google, github)
	OAuthConfigKey     string
	DefaultPermissions []string // Default permissions from manifest (e.g. gmail:read, gmail:write)

	// Flags
	RequiresSync            bool     // Whether sync with server is required
	SupportsBackgroundTasks bool     // Whether background tasks are supported (for ClientOnly)
	SystemEventListeners    []string // List of system events the integration listens to

	// Additional metadata
	Description string
	Icon        string // Icon name for UI
}

// OAuthConfig contains OAuth configuration for provider
type OAuthConfig struct {
	Endpoint  oauth2.Endpoint                     // OAuth endpoints
	Scopes    []string                            // Required scopes
	IsOIDC    bool                                // Whether it uses OIDC
	IssuerURL string                              // Issuer URL for OIDC (if applicable)
	GetScopes func(permissions []string) []string // Function to get scopes
}

// knownOAuthEndpoints maps oauth_config_key to oauth2.Endpoint for known providers
var knownOAuthEndpoints = map[string]oauth2.Endpoint{
	"google":          google.Endpoint,
	"google_gmail":    google.Endpoint,
	"google_calendar": google.Endpoint,
	"github":          github.Endpoint,
}

var (
	// Registry contains all available providers (populated by InitRegistry from plugin manifests)
	Registry = make(map[string]*ProviderDefinition)
)

// InitRegistry loads plugin manifests from pluginsDir and builds Registry.
// Should be called once at startup (e.g. from main).
func InitRegistry(pluginsDir string, logger *zap.Logger) error {
	if pluginsDir == "" {
		pluginsDir = "plugins"
	}
	_, err := plugins.Load(pluginsDir, logger)
	if err != nil {
		return err
	}
	Registry = buildRegistryFromManifests(plugins.Manifests)
	return nil
}

func buildRegistryFromManifests(manifests []*plugins.Manifest) map[string]*ProviderDefinition {
	out := make(map[string]*ProviderDefinition)
	for _, m := range manifests {
		if m.Name == "" {
			continue
		}
		p := &ProviderDefinition{
			Name:                    m.Name,
			DisplayName:             m.DisplayName,
			Description:             m.Description,
			Type:                    m.Auth.Type,
			RequiresSync:            m.Execution.Type == "server" || m.Execution.Type == "hybrid",
			SupportsBackgroundTasks: m.BackgroundTasks.Enabled && (m.Execution.Type == "client" || m.Execution.Type == "hybrid"),
			SystemEventListeners:    m.BackgroundTasks.SystemEvents,
			Icon:                    m.UI.Icon,
			OAuthConfigKey:          m.Auth.OAuthConfigKey,
			DefaultPermissions:      m.Auth.Permissions,
		}
		switch m.Execution.Type {
		case "client":
			p.StorageType = StorageTypeClientOnly
		case "server":
			p.StorageType = StorageTypeServer
		default:
			p.StorageType = StorageTypeHybrid
		}
		if m.Auth.Type == "oauth2" && m.Auth.OAuthConfigKey != "" {
			endpoint, ok := knownOAuthEndpoints[m.Auth.OAuthConfigKey]
			if !ok {
				continue
			}
			p.OAuthConfig = &OAuthConfig{
				Endpoint:  endpoint,
				IsOIDC:    m.Auth.OIDCIssuerURL != "",
				IssuerURL: m.Auth.OIDCIssuerURL,
			}
			if m.Auth.OIDCIssuerURL != "" {
				defaultPerms := append([]string(nil), p.DefaultPermissions...)
				p.OAuthConfig.GetScopes = func(permissions []string) []string {
					if len(permissions) == 0 {
						permissions = defaultPerms
					}
					scopes := []string{oidc.ScopeOpenID, "email", "profile"}
					for _, perm := range permissions {
						scopes = append(scopes, providers.GetGoogleScope(perm)...)
					}
					return scopes
				}
			} else {
				scopes := m.Auth.Scopes
				if len(scopes) == 0 {
					scopes = []string{"repo", "user", "read:org"}
				}
				p.OAuthConfig.Scopes = scopes
			}
		}
		out[m.Name] = p
	}
	return out
}

// GetProvider returns provider definition by name
func GetProvider(name string) (*ProviderDefinition, bool) {
	provider, ok := Registry[name]
	return provider, ok
}

// GetClientOnlyProviders returns list of ClientOnly providers
func GetClientOnlyProviders() []*ProviderDefinition {
	var provs []*ProviderDefinition
	for _, provider := range Registry {
		if provider.StorageType == StorageTypeClientOnly {
			provs = append(provs, provider)
		}
	}
	return provs
}

// GetServerProviders returns list of Server providers
func GetServerProviders() []*ProviderDefinition {
	var provs []*ProviderDefinition
	for _, provider := range Registry {
		if provider.StorageType == StorageTypeServer {
			provs = append(provs, provider)
		}
	}
	return provs
}

// ShouldSync checks if sync is required for provider
func ShouldSync(providerName string) bool {
	provider, ok := GetProvider(providerName)
	if !ok {
		return false
	}
	return provider.RequiresSync && provider.StorageType != StorageTypeClientOnly
}

// SupportsBackgroundTasks checks if provider supports background tasks
func SupportsBackgroundTasks(providerName string) bool {
	provider, ok := GetProvider(providerName)
	if !ok {
		return false
	}
	return provider.SupportsBackgroundTasks && provider.StorageType == StorageTypeClientOnly
}
