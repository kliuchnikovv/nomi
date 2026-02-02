package integrations

import (
	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/kliuchnikovv/genie-api/internal/providers"
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

var (
	// Registry contains all available providers
	Registry = map[string]*ProviderDefinition{
		"gmail": {
			Name:        "gmail",
			DisplayName: "Gmail",
			Type:        "oauth2",
			StorageType: StorageTypeClientOnly,
			OAuthConfig: &OAuthConfig{
				Endpoint:  google.Endpoint,
				IsOIDC:    true,
				IssuerURL: "https://accounts.google.com",
				GetScopes: func(permissions []string) []string {
					scopes := []string{oidc.ScopeOpenID, "email", "profile"}
					for _, perm := range permissions {
						scopes = append(scopes, providers.GetGoogleScope(perm)...)
					}
					return scopes
				},
			},
			RequiresSync:            false,
			SupportsBackgroundTasks: true,
			SystemEventListeners:    []string{"push_notifications", "app_lifecycle"},
			Description:             "Gmail integration for email management",
			Icon:                    "gmail",
		},
		"calendar": {
			Name:        "calendar",
			DisplayName: "Google Calendar",
			Type:        "oauth2",
			StorageType: StorageTypeClientOnly,
			OAuthConfig: &OAuthConfig{
				Endpoint:  google.Endpoint,
				IsOIDC:    true,
				IssuerURL: "https://accounts.google.com",
				GetScopes: func(permissions []string) []string {
					scopes := []string{oidc.ScopeOpenID, "email", "profile"}
					for _, perm := range permissions {
						scopes = append(scopes, providers.GetGoogleScope(perm)...)
					}
					return scopes
				},
			},
			RequiresSync:            false,
			SupportsBackgroundTasks: true,
			SystemEventListeners:    []string{"push_notifications", "app_lifecycle"},
			Description:             "Google Calendar integration for calendar management",
			Icon:                    "calendar",
		},
		"github": {
			Name:        "github",
			DisplayName: "GitHub",
			Type:        "oauth2",
			StorageType: StorageTypeServer,
			OAuthConfig: &OAuthConfig{
				Endpoint: github.Endpoint,
				IsOIDC:   false,
				Scopes:   []string{"repo", "user", "read:org"},
			},
			RequiresSync:            true,
			SupportsBackgroundTasks: false,
			SystemEventListeners:    []string{},
			Description:             "GitHub integration for repository management",
			Icon:                    "github",
		},
	}
)

// GetProvider returns provider definition by name
func GetProvider(name string) (*ProviderDefinition, bool) {
	provider, ok := Registry[name]
	return provider, ok
}

// GetClientOnlyProviders returns list of ClientOnly providers
func GetClientOnlyProviders() []*ProviderDefinition {
	var providers []*ProviderDefinition
	for _, provider := range Registry {
		if provider.StorageType == StorageTypeClientOnly {
			providers = append(providers, provider)
		}
	}
	return providers
}

// GetServerProviders returns list of Server providers
func GetServerProviders() []*ProviderDefinition {
	var providers []*ProviderDefinition
	for _, provider := range Registry {
		if provider.StorageType == StorageTypeServer {
			providers = append(providers, provider)
		}
	}
	return providers
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
