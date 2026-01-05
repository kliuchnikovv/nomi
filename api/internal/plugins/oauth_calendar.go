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
	ProviderCalendar = "calendar"
)

// CalendarIntegration handles OAuth for Google Calendar and stores tokens/config.
type CalendarIntegration struct {
	cfg          *config.Config
	storage      *storage.Storage
	logger       *zap.Logger
	oauthConfig  *oauth2.Config
	oidcProvider *oidc.Provider
}

func NewCalendarIntegration(
	logger *zap.Logger,
	cfg *config.Config,
	store *storage.Storage,
) (*CalendarIntegration, error) {
	providerCfg, ok := cfg.OAuth2.Providers["google"]
	if !ok {
		return nil, fmt.Errorf("google provider config not found")
	}

	scopes := []string{oidc.ScopeOpenID, "email", "profile"}
	scopes = append(scopes, providers.GetGoogleScope("calendar:read")...)
	scopes = append(scopes, providers.GetGoogleScope("calendar:write")...)

	oauthConfig := &oauth2.Config{
		ClientID:     providerCfg.ClientID,
		ClientSecret: providerCfg.ClientSecret,
		RedirectURL:  fmt.Sprintf("%s/api/oauth/%s/callback", cfg.OAuth2.CallbackBase, ProviderCalendar),
		Scopes:       scopes,
		Endpoint:     google.Endpoint,
	}

	provider, err := oidc.NewProvider(context.Background(), "https://accounts.google.com")
	if err != nil {
		return nil, fmt.Errorf("failed to create google oidc provider: %w", err)
	}

	return &CalendarIntegration{
		cfg:          cfg,
		storage:      store,
		logger:       logger,
		oauthConfig:  oauthConfig,
		oidcProvider: provider,
	}, nil
}

func (c *CalendarIntegration) GetAuthURL(state string) string {
	return c.oauthConfig.AuthCodeURL(
		state,
		oauth2.AccessTypeOffline,
		oauth2.ApprovalForce,
		oauth2.SetAuthURLParam("prompt", "consent"),
		oauth2.SetAuthURLParam("include_granted_scopes", "true"),
	)
}

func (c *CalendarIntegration) HandleCallback(ctx context.Context, code string, user *storage.User) (string, error) {
	token, err := c.oauthConfig.Exchange(ctx, code)
	if err != nil {
		return "", fmt.Errorf("token exchange failed: %w", err)
	}

	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		return "", errors.New("id_token missing")
	}

	verifier := c.oidcProvider.Verifier(&oidc.Config{ClientID: c.oauthConfig.ClientID})
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
	// If the user uses the web flow, we might lose functionality without tokens,
	// but the requirement is "client-side only".

	// We NO LONGER save the token to the database or update it.
	// We only want to ensure the integration metadata exists.
	// If the user uses the web flow, we might lose functionality without tokens,
	// but the requirement is "client-side only".

	params := map[string]any{
		"account_email": claims.Email,
		// No credentials here anymore
	}
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return "", fmt.Errorf("failed to marshal integration params: %w", err)
	}

	tools, err := c.storage.GetIntegrations(ctx, user.ID)
	if err != nil {
		return "", fmt.Errorf("failed to list integrations: %w", err)
	}

	var existingTool *storage.Integration
	for _, t := range tools {
		accountEmail, _ := extractAccountEmail(t.Params)
		if t.Provider == ProviderCalendar && accountEmail == claims.Email {
			existingTool = &t
			break
		}
	}

	if existingTool != nil {
		existingTool.Params = string(paramsJSON)
		existingTool.Name = fmt.Sprintf("Google Calendar (%s)", claims.Email)
		if _, err := c.storage.UpdateIntegration(ctx, user.ID, existingTool); err != nil {
			return "", fmt.Errorf("failed to update integration: %w", err)
		}
	} else {
		newTool := &storage.Integration{
			UserID:   user.ID,
			Name:     fmt.Sprintf("Google Calendar (%s)", claims.Email),
			Provider: ProviderCalendar,
			Params:   string(paramsJSON),
			Enabled:  true,
		}
		if _, err := c.storage.CreateIntegration(ctx, user.ID, newTool); err != nil {
			return "", fmt.Errorf("failed to create integration: %w", err)
		}
	}

	return claims.Email, nil
}

func extractAccountEmail(params string) (string, error) {
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
