package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/providers"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/lib/pq"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"gorm.io/gorm"
)

const (
	ProviderGmail = "gmail"
)

type GmailIntegration struct {
	cfg          *config.Config
	storage      *storage.Storage
	logger       *zap.Logger
	oauthConfig  *oauth2.Config
	oidcProvider *oidc.Provider
}

func NewGmailIntegration(
	logger *zap.Logger,
	cfg *config.Config,
	store *storage.Storage,
) (*GmailIntegration, error) {
	// Setup OAuth2 Config
	providerCfg, ok := cfg.OAuth2.Providers["google"]
	if !ok {
		return nil, fmt.Errorf("google provider config not found")
	}

	scopes := []string{oidc.ScopeOpenID, "email", "profile"}
	// Add Gmail specific scopes
	scopes = append(scopes, providers.GetGoogleScope("gmail:read")...)
	scopes = append(scopes, providers.GetGoogleScope("gmail:write")...)

	oauthConfig := &oauth2.Config{
		ClientID:     providerCfg.ClientID,
		ClientSecret: providerCfg.ClientSecret,
		RedirectURL:  fmt.Sprintf("%s/api/oauth/%s/callback", cfg.OAuth2.CallbackBase, ProviderGmail),
		Scopes:       scopes,
		Endpoint:     google.Endpoint,
	}

	// Setup OIDC Provider
	provider, err := oidc.NewProvider(context.Background(), "https://accounts.google.com")
	if err != nil {
		return nil, fmt.Errorf("failed to create google oidc provider: %w", err)
	}

	return &GmailIntegration{
		cfg:          cfg,
		storage:      store,
		logger:       logger,
		oauthConfig:  oauthConfig,
		oidcProvider: provider,
	}, nil
}

func (g *GmailIntegration) GetAuthURL(state string) string {
	return g.oauthConfig.AuthCodeURL(
		state,
		oauth2.AccessTypeOffline,
		oauth2.ApprovalForce,
		oauth2.SetAuthURLParam("prompt", "consent"),
		oauth2.SetAuthURLParam("include_granted_scopes", "true"),
	)
}

func (g *GmailIntegration) HandleCallback(ctx context.Context, code string, user *storage.User) (string, error) {
	// 1. Exchange code for token
	token, err := g.oauthConfig.Exchange(ctx, code)
	if err != nil {
		return "", fmt.Errorf("token exchange failed: %w", err)
	}

	// 2. Verify ID Token
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		return "", errors.New("id_token missing")
	}

	verifier := g.oidcProvider.Verifier(&oidc.Config{ClientID: g.oauthConfig.ClientID})
	idToken, err := verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return "", fmt.Errorf("failed to verify id_token: %w", err)
	}

	var claims struct {
		Email string `json:"email"`
		Sub   string `json:"sub"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return "", fmt.Errorf("failed to read claims: %w", err)
	}

	// 3. Save Token
	tokenBytes, err := json.Marshal(token)
	if err != nil {
		return "", fmt.Errorf("failed to encode token: %w", err)
	}

	newToken := &storage.OAuthToken{
		UserID:         user.ID,
		ProfileID:      user.ID.String(),
		Provider:       ProviderGmail,
		AccountEmail:   claims.Email,
		ExternalUserID: claims.Sub,
		Scopes:         pq.StringArray(g.oauthConfig.Scopes),
		TokenEncrypted: tokenBytes,
		Version:        1,
	}

	existing, err := g.storage.GetOAuthTokenByUser(ctx, user.ID, ProviderGmail)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", fmt.Errorf("failed to check existing token: %w", err)
	}

	if errors.Is(err, gorm.ErrRecordNotFound) {
		if err := g.storage.SaveOAuthToken(ctx, newToken); err != nil {
			return "", fmt.Errorf("failed to save token: %w", err)
		}
	} else {
		existing.AccountEmail = newToken.AccountEmail
		existing.ExternalUserID = newToken.ExternalUserID
		existing.TokenEncrypted = newToken.TokenEncrypted
		existing.Scopes = newToken.Scopes
		existing.ProfileID = newToken.ProfileID
		if err := g.storage.UpdateOAuthToken(ctx, existing); err != nil {
			return "", fmt.Errorf("failed to update token: %w", err)
		}
	}

	// 4. Create or Update Tool
	params := map[string]any{
		"creds": map[string]any{
			"token":         token.AccessToken,
			"refresh_token": token.RefreshToken,
			"token_type":    token.TokenType,
			"expiry":        token.Expiry,
			"client_id":     g.oauthConfig.ClientID,
			"client_secret": g.oauthConfig.ClientSecret,
			"token_uri":     g.oauthConfig.Endpoint.TokenURL,
		},
	}
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return "", fmt.Errorf("failed to marshal tool params: %w", err)
	}

	tools, err := g.storage.GetIntegrations(ctx, user.ID)
	if err != nil {
		return "", fmt.Errorf("failed to list tools: %w", err)
	}

	var existingTool *storage.Integration
	for _, t := range tools {
		if t.Provider == ProviderGmail {
			existingTool = &t
			break
		}
	}

	if existingTool != nil {
		existingTool.Params = string(paramsJSON)
		existingTool.Name = "Gmail" // Ensure name is set/updated
		if _, err := g.storage.UpdateIntegration(ctx, user.ID, existingTool); err != nil {
			return "", fmt.Errorf("failed to update tool: %w", err)
		}
	} else {
		newTool := &storage.Integration{
			UserID:   user.ID,
			Name:     "Gmail",
			Provider: ProviderGmail,
			Params:   string(paramsJSON),
			Enabled:  true,
		}
		if _, err := g.storage.CreateIntegration(ctx, user.ID, newTool); err != nil {
			return "", fmt.Errorf("failed to create tool: %w", err)
		}
	}

	return claims.Email, nil
}
