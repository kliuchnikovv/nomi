package integrations

import (
	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/kliuchnikovv/genie-api/internal/providers"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"
	"golang.org/x/oauth2/google"
)

// StorageType определяет тип хранения данных интеграции
type StorageType string

const (
	StorageTypeClientOnly StorageType = "client"  // Данные только в SQLite на устройстве
	StorageTypeServer     StorageType = "server"  // Данные на сервере в PostgreSQL
	StorageTypeHybrid     StorageType = "hybrid"   // Гибридное хранение
)

// ProviderDefinition содержит метаданные провайдера интеграции
type ProviderDefinition struct {
	// Базовые метаданные
	Name        string   // Имя провайдера (gmail, calendar, github, jules)
	DisplayName string   // Отображаемое имя
	Type        string   // Тип интеграции (oauth2, api_key, etc.)
	StorageType StorageType // Тип хранения данных

	// OAuth конфигурация
	OAuthConfig *OAuthConfig

	// Флаги
	RequiresSync            bool     // Требуется ли синхронизация с сервером
	SupportsBackgroundTasks bool     // Поддерживает ли фоновые процессы (для ClientOnly)
	SystemEventListeners    []string // Список системных событий, которые слушает интеграция

	// Дополнительные метаданные
	Description string
	Icon        string // Имя иконки для UI
}

// OAuthConfig содержит конфигурацию OAuth для провайдера
type OAuthConfig struct {
	Endpoint    oauth2.Endpoint // OAuth endpoints
	Scopes      []string        // Требуемые scopes
	IsOIDC      bool            // Использует ли OIDC
	IssuerURL   string          // URL issuer для OIDC (если применимо)
	GetScopes   func(permissions []string) []string // Функция для получения scopes
}

var (
	// Registry содержит реестр всех доступных провайдеров
	Registry = map[string]*ProviderDefinition{
		"gmail": {
			Name:        "gmail",
			DisplayName: "Gmail",
			Type:        "oauth2",
			StorageType: StorageTypeClientOnly,
			OAuthConfig: &OAuthConfig{
				Endpoint: google.Endpoint,
				IsOIDC:   true,
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
			Description:             "Gmail интеграция для работы с почтой",
			Icon:                    "gmail",
		},
		"calendar": {
			Name:        "calendar",
			DisplayName: "Google Calendar",
			Type:        "oauth2",
			StorageType: StorageTypeClientOnly,
			OAuthConfig: &OAuthConfig{
				Endpoint: google.Endpoint,
				IsOIDC:   true,
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
			Description:             "Google Calendar интеграция для работы с календарем",
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
			Description:             "GitHub интеграция для работы с репозиториями",
			Icon:                    "github",
		},
		"jules": {
			Name:        "jules",
			DisplayName: "Jules",
			Type:        "api_key",
			StorageType: StorageTypeServer,
			OAuthConfig: nil, // Jules использует API ключ, не OAuth
			RequiresSync:            true,
			SupportsBackgroundTasks: false,
			SystemEventListeners:    []string{},
			Description:             "Jules API интеграция для автоматизации задач",
			Icon:                    "jules",
		},
	}
)

// GetProvider возвращает определение провайдера по имени
func GetProvider(name string) (*ProviderDefinition, bool) {
	provider, ok := Registry[name]
	return provider, ok
}

// GetClientOnlyProviders возвращает список провайдеров с типом ClientOnly
func GetClientOnlyProviders() []*ProviderDefinition {
	var providers []*ProviderDefinition
	for _, provider := range Registry {
		if provider.StorageType == StorageTypeClientOnly {
			providers = append(providers, provider)
		}
	}
	return providers
}

// GetServerProviders возвращает список провайдеров с типом Server
func GetServerProviders() []*ProviderDefinition {
	var providers []*ProviderDefinition
	for _, provider := range Registry {
		if provider.StorageType == StorageTypeServer {
			providers = append(providers, provider)
		}
	}
	return providers
}

// ShouldSync проверяет, требуется ли синхронизация для провайдера
func ShouldSync(providerName string) bool {
	provider, ok := GetProvider(providerName)
	if !ok {
		return false
	}
	return provider.RequiresSync && provider.StorageType != StorageTypeClientOnly
}

// SupportsBackgroundTasks проверяет, поддерживает ли провайдер фоновые задачи
func SupportsBackgroundTasks(providerName string) bool {
	provider, ok := GetProvider(providerName)
	if !ok {
		return false
	}
	return provider.SupportsBackgroundTasks && provider.StorageType == StorageTypeClientOnly
}
