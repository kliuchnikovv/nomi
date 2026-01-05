package plugins

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/providers"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const (
	ProviderGmail = "gmail"
)

// GmailIntegration handles OAuth for Gmail and persists tokens/integration config.
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
	providerCfg, ok := cfg.OAuth2.Providers["google"]
	if !ok {
		return nil, fmt.Errorf("google provider config not found")
	}

	scopes := []string{oidc.ScopeOpenID, "email", "profile"}
	scopes = append(scopes, providers.GetGoogleScope("gmail:read")...)
	scopes = append(scopes, providers.GetGoogleScope("gmail:write")...)

	oauthConfig := &oauth2.Config{
		ClientID:     providerCfg.ClientID,
		ClientSecret: providerCfg.ClientSecret,
		RedirectURL:  fmt.Sprintf("%s/api/oauth/%s/callback", cfg.OAuth2.CallbackBase, ProviderGmail),
		Scopes:       scopes,
		Endpoint:     google.Endpoint,
	}

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
	token, err := g.oauthConfig.Exchange(ctx, code)
	if err != nil {
		return "", fmt.Errorf("token exchange failed: %w", err)
	}

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

	// We NO LONGER save the token to the database or update it.
	// We only want to ensure the integration metadata exists.

	// We NO LONGER save the token to the database or update it.
	// We only want to ensure the integration metadata exists.

	params := map[string]any{
		"account_email": claims.Email,
		// No credentials here anymore
	}
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return "", fmt.Errorf("failed to marshal integration params: %w", err)
	}

	tools, err := g.storage.GetIntegrations(ctx, user.ID)
	if err != nil {
		return "", fmt.Errorf("failed to list integrations: %w", err)
	}

	var existingTool *storage.Integration
	for _, t := range tools {
		accountEmail, _ := extractGmailAccountEmail(t.Params)
		if t.Provider == ProviderGmail && accountEmail == claims.Email {
			existingTool = &t
			break
		}
	}

	if existingTool != nil {
		existingTool.Params = string(paramsJSON)
		existingTool.Name = fmt.Sprintf("Gmail (%s)", claims.Email)
		if _, err := g.storage.UpdateIntegration(ctx, user.ID, existingTool); err != nil {
			return "", fmt.Errorf("failed to update integration: %w", err)
		}
	} else {
		newTool := &storage.Integration{
			UserID:   user.ID,
			Name:     fmt.Sprintf("Gmail (%s)", claims.Email),
			Provider: ProviderGmail,
			Params:   string(paramsJSON),
			Enabled:  true,
		}
		if _, err := g.storage.CreateIntegration(ctx, user.ID, newTool); err != nil {
			return "", fmt.Errorf("failed to create integration: %w", err)
		}
	}

	return claims.Email, nil
}

func extractGmailAccountEmail(params string) (string, error) {
	if params == "" {
		return "", fmt.Errorf("params empty")
	}
	var parsed struct {
		AccountEmail string `json:"account_email"`
	}
	if err := json.Unmarshal([]byte(params), &parsed); err != nil {
		return "", err
	}
	return parsed.AccountEmail, nil
}
