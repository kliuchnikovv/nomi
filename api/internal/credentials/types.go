package credentials

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// CredentialType represents the type of credential
type CredentialType string

const (
	CredentialTypeOAuth  CredentialType = "oauth"
	CredentialTypeAPIKey CredentialType = "api_key"
	CredentialTypeCustom CredentialType = "custom"
)

// CredentialData holds credential information stored in Redis
type CredentialData struct {
	Type         CredentialType         `json:"type"`
	AccessToken  string                 `json:"access_token,omitempty"`
	RefreshToken string                 `json:"refresh_token,omitempty"`
	ExpiresAt    *time.Time             `json:"expires_at,omitempty"`
	APIKey       string                 `json:"api_key,omitempty"`
	Extra        map[string]interface{} `json:"extra,omitempty"`
}

// IsExpired checks if the credential has expired
func (c *CredentialData) IsExpired() bool {
	if c.ExpiresAt == nil {
		return false
	}
	return time.Now().After(*c.ExpiresAt)
}

// NeedsRefresh checks if credential needs refresh (5 min buffer before expiry)
func (c *CredentialData) NeedsRefresh() bool {
	if c.ExpiresAt == nil {
		return false
	}
	return time.Now().Add(5 * time.Minute).After(*c.ExpiresAt)
}

// ToJSON serializes credential data to JSON
func (c *CredentialData) ToJSON() ([]byte, error) {
	return json.Marshal(c)
}

// FromJSON deserializes credential data from JSON
func CredentialDataFromJSON(data []byte) (*CredentialData, error) {
	var cred CredentialData
	if err := json.Unmarshal(data, &cred); err != nil {
		return nil, err
	}
	return &cred, nil
}

// Store defines the interface for credential storage
type Store interface {
	// Save stores credentials with optional TTL
	Save(ctx context.Context, userID uuid.UUID, provider string, data *CredentialData, ttl time.Duration) error

	// Get retrieves credentials and extends TTL if extendTTL is true
	Get(ctx context.Context, userID uuid.UUID, provider string, extendTTL time.Duration) (*CredentialData, error)

	// Delete removes credentials
	Delete(ctx context.Context, userID uuid.UUID, provider string) error

	// Exists checks if credentials exist (without extending TTL)
	Exists(ctx context.Context, userID uuid.UUID, provider string) (bool, error)

	// ListProviders returns all providers that have stored credentials for user
	ListProviders(ctx context.Context, userID uuid.UUID) ([]string, error)
}

// RedisKey generates Redis key for credentials
func RedisKey(userID uuid.UUID, provider string) string {
	return fmt.Sprintf("credentials:%s:%s", userID.String(), provider)
}
