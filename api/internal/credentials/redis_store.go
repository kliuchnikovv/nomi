package credentials

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const (
	// DefaultTTL is the default time-to-live for credentials in Redis (1 hour)
	DefaultTTL = 1 * time.Hour

	// RefreshBuffer is the time buffer before expiry when we consider credentials need refresh
	RefreshBuffer = 5 * time.Minute
)

// RedisStore implements Store interface using Redis
type RedisStore struct {
	client *redis.Client
}

// NewRedisStore creates a new Redis-backed credential store
func NewRedisStore(client *redis.Client) *RedisStore {
	return &RedisStore{client: client}
}

// Save stores credentials in Redis with TTL
func (s *RedisStore) Save(ctx context.Context, userID uuid.UUID, provider string, data *CredentialData, ttl time.Duration) error {
	if ttl == 0 {
		ttl = DefaultTTL
	}

	key := RedisKey(userID, provider)

	dataJSON, err := data.ToJSON()
	if err != nil {
		return fmt.Errorf("failed to serialize credentials: %w", err)
	}

	// Use SET with EX for automatic expiration
	err = s.client.Set(ctx, key, dataJSON, ttl).Err()
	if err != nil {
		return fmt.Errorf("failed to save credentials to redis: %w", err)
	}

	return nil
}

// Get retrieves credentials and optionally extends TTL
func (s *RedisStore) Get(ctx context.Context, userID uuid.UUID, provider string, extendTTL time.Duration) (*CredentialData, error) {
	key := RedisKey(userID, provider)

	data, err := s.client.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, fmt.Errorf("credentials not found for user %s, provider %s", userID, provider)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get credentials from redis: %w", err)
	}

	cred, err := CredentialDataFromJSON(data)
	if err != nil {
		return nil, fmt.Errorf("failed to deserialize credentials: %w", err)
	}

	// Extend TTL if requested (default behavior: extend by 1 hour)
	if extendTTL > 0 {
		err = s.client.Expire(ctx, key, extendTTL).Err()
		if err != nil {
			// Log but don't fail - we still have the credentials
			fmt.Printf("[Credentials] Failed to extend TTL for %s: %v\n", key, err)
		}
	}

	return cred, nil
}

// Delete removes credentials from Redis
func (s *RedisStore) Delete(ctx context.Context, userID uuid.UUID, provider string) error {
	key := RedisKey(userID, provider)

	err := s.client.Del(ctx, key).Err()
	if err != nil {
		return fmt.Errorf("failed to delete credentials from redis: %w", err)
	}

	return nil
}

// Exists checks if credentials exist without modifying TTL
func (s *RedisStore) Exists(ctx context.Context, userID uuid.UUID, provider string) (bool, error) {
	key := RedisKey(userID, provider)

	exists, err := s.client.Exists(ctx, key).Result()
	if err != nil {
		return false, fmt.Errorf("failed to check credentials existence: %w", err)
	}

	return exists > 0, nil
}

// ListProviders returns all providers that have stored credentials for user
func (s *RedisStore) ListProviders(ctx context.Context, userID uuid.UUID) ([]string, error) {
	pattern := fmt.Sprintf("credentials:%s:*", userID.String())

	keys, err := s.client.Keys(ctx, pattern).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to list credential keys: %w", err)
	}

	// Extract provider names from keys
	providers := make([]string, 0, len(keys))
	prefix := fmt.Sprintf("credentials:%s:", userID.String())
	for _, key := range keys {
		provider := key[len(prefix):]
		if provider != "" {
			providers = append(providers, provider)
		}
	}

	return providers, nil
}

// GetWithAutoExtend retrieves credentials and automatically extends TTL to default
func (s *RedisStore) GetWithAutoExtend(ctx context.Context, userID uuid.UUID, provider string) (*CredentialData, error) {
	return s.Get(ctx, userID, provider, DefaultTTL)
}

// Touch extends the TTL of credentials without retrieving them
func (s *RedisStore) Touch(ctx context.Context, userID uuid.UUID, provider string, ttl time.Duration) error {
	if ttl == 0 {
		ttl = DefaultTTL
	}

	key := RedisKey(userID, provider)

	ok, err := s.client.Expire(ctx, key, ttl).Result()
	if err != nil {
		return fmt.Errorf("failed to touch credentials: %w", err)
	}

	if !ok {
		return fmt.Errorf("credentials not found for touch: %s", key)
	}

	return nil
}

// SaveAPIKey is a helper to save API key type credentials
func (s *RedisStore) SaveAPIKey(ctx context.Context, userID uuid.UUID, provider, apiKey string, ttl time.Duration) error {
	data := &CredentialData{
		Type:   CredentialTypeAPIKey,
		APIKey: apiKey,
	}
	return s.Save(ctx, userID, provider, data, ttl)
}

// SaveOAuth is a helper to save OAuth type credentials
func (s *RedisStore) SaveOAuth(ctx context.Context, userID uuid.UUID, provider string, accessToken, refreshToken string, expiresAt *time.Time, ttl time.Duration) error {
	data := &CredentialData{
		Type:         CredentialTypeOAuth,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresAt:    expiresAt,
	}
	return s.Save(ctx, userID, provider, data, ttl)
}
