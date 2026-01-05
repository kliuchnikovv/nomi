package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/plugins"
	"github.com/kliuchnikovv/genie-api/internal/providers"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// MobileOAuthHandler handles OAuth flows for mobile clients.
// Unlike regular OAuth, tokens are returned to the client instead of being stored on the backend.
type MobileOAuthHandler struct {
	cfg            *config.Config
	storage        *storage.Storage
	logger         *zap.Logger
	gmailConfig    *oauth2.Config
	calendarConfig *oauth2.Config
	oidcProvider   *oidc.Provider
}

// MobileOAuthResponse contains tokens returned to the mobile client
type MobileOAuthResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenExpiry  int64  `json:"token_expiry"` // Unix timestamp
	AccountEmail string `json:"account_email"`
	Provider     string `json:"provider"`
}

// RefreshTokenRequest is the request body for token refresh
type RefreshTokenRequest struct {
	Provider     string `json:"provider" binding:"required"`
	RefreshToken string `json:"refresh_token" binding:"required"`
}

// RefreshTokenResponse is returned after refreshing tokens
type RefreshTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenExpiry int64  `json:"token_expiry"` // Unix timestamp
}

// NewMobileOAuthHandler creates a new mobile OAuth handler
func NewMobileOAuthHandler(
	logger *zap.Logger,
	cfg *config.Config,
	db *storage.Storage,
) (*MobileOAuthHandler, error) {
	providerCfg, ok := cfg.OAuth2.Providers["google"]
	if !ok {
		return nil, fmt.Errorf("google provider config not found")
	}

	// Gmail Config
	gmailScopes := []string{oidc.ScopeOpenID, "email", "profile"}
	gmailScopes = append(gmailScopes, providers.GetGoogleScope("gmail:read")...)
	gmailScopes = append(gmailScopes, providers.GetGoogleScope("gmail:write")...)

	gmailConfig := &oauth2.Config{
		ClientID:     providerCfg.ClientID,
		ClientSecret: providerCfg.ClientSecret,
		RedirectURL:  fmt.Sprintf("%s/api/oauth/%s/callback", cfg.OAuth2.CallbackBase, plugins.ProviderGmail),
		Scopes:       gmailScopes,
		Endpoint:     google.Endpoint,
	}

	// Calendar Config
	calScopes := []string{oidc.ScopeOpenID, "email", "profile"}
	calScopes = append(calScopes, providers.GetGoogleScope("calendar:read")...)
	calScopes = append(calScopes, providers.GetGoogleScope("calendar:write")...)

	calendarConfig := &oauth2.Config{
		ClientID:     providerCfg.ClientID,
		ClientSecret: providerCfg.ClientSecret,
		RedirectURL:  fmt.Sprintf("%s/api/oauth/%s/callback", cfg.OAuth2.CallbackBase, plugins.ProviderCalendar),
		Scopes:       calScopes,
		Endpoint:     google.Endpoint,
	}

	provider, err := oidc.NewProvider(context.Background(), "https://accounts.google.com")
	if err != nil {
		return nil, fmt.Errorf("failed to create google oidc provider: %w", err)
	}

	return &MobileOAuthHandler{
		cfg:            cfg,
		storage:        db,
		logger:         logger,
		gmailConfig:    gmailConfig,
		calendarConfig: calendarConfig,
		oidcProvider:   provider,
	}, nil
}

// CallbackMobile exchanges the authorization code for tokens and returns them to the client.
// POST /api/oauth/:provider/callback-mobile
// Request: { "code": "..." }
// Response: MobileOAuthResponse
func (h *MobileOAuthHandler) CallbackMobile(c *gin.Context) {
	ctx := c.Request.Context()
	providerName := c.Param("provider")

	var oauthConfig *oauth2.Config
	if providerName == plugins.ProviderGmail {
		oauthConfig = h.gmailConfig
	} else if providerName == plugins.ProviderCalendar {
		oauthConfig = h.calendarConfig
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("provider %s not supported for mobile OAuth", providerName)})
		return
	}

	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code is required"})
		return
	}

	// Exchange code for tokens
	token, err := oauthConfig.Exchange(ctx, req.Code)
	if err != nil {
		h.logger.Error("token exchange failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token exchange failed"})
		return
	}

	// Get user email from ID token
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "id_token missing from response"})
		return
	}

	verifier := h.oidcProvider.Verifier(&oidc.Config{ClientID: oauthConfig.ClientID})
	idToken, err := verifier.Verify(ctx, rawIDToken)
	if err != nil {
		h.logger.Error("failed to verify id_token", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to verify id_token"})
		return
	}

	var claims struct {
		Email string `json:"email"`
	}
	if err := idToken.Claims(&claims); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read email claim"})
		return
	}

	// Return tokens to client WITHOUT saving to backend database
	response := MobileOAuthResponse{
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		TokenExpiry:  token.Expiry.Unix(),
		AccountEmail: claims.Email,
		Provider:     providerName,
	}

	h.logger.Info("mobile OAuth callback successful",
		zap.String("provider", providerName),
		zap.String("email", claims.Email),
	)

	c.JSON(http.StatusOK, response)
}

// RefreshToken refreshes an access token using a refresh token.
// The backend uses the client_secret to refresh the token, then returns new tokens to the client.
// POST /api/oauth/refresh
// Request: RefreshTokenRequest
// Response: RefreshTokenResponse
func (h *MobileOAuthHandler) RefreshToken(c *gin.Context) {
	ctx := c.Request.Context()

	var req RefreshTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider and refresh_token are required"})
		return
	}

	var oauthConfig *oauth2.Config
	if req.Provider == plugins.ProviderGmail {
		oauthConfig = h.gmailConfig
	} else if req.Provider == plugins.ProviderCalendar {
		oauthConfig = h.calendarConfig
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("provider %s not supported", req.Provider)})
		return
	}

	// Create a token source from the refresh token
	tokenSource := oauthConfig.TokenSource(ctx, &oauth2.Token{
		RefreshToken: req.RefreshToken,
	})

	// Get a new token (this triggers the refresh)
	newToken, err := tokenSource.Token()
	if err != nil {
		h.logger.Error("token refresh failed",
			zap.String("provider", req.Provider),
			zap.Error(err),
		)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "token refresh failed - please re-authenticate"})
		return
	}

	response := RefreshTokenResponse{
		AccessToken: newToken.AccessToken,
		TokenExpiry: newToken.Expiry.Unix(),
	}

	h.logger.Debug("token refreshed successfully", zap.String("provider", req.Provider))
	c.JSON(http.StatusOK, response)
}

// ExportIntegrations exports all integrations for migration to client-side storage.
// This is a one-time migration endpoint.
// GET /api/integrations/export
func (h *MobileOAuthHandler) ExportIntegrations(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	integrations, err := h.storage.GetIntegrations(ctx, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load integrations"})
		return
	}

	// Filter to Gmail only and return with decrypted credentials
	type ExportedIntegration struct {
		ID           uuid.UUID `json:"id"`
		Provider     string    `json:"provider"`
		Name         string    `json:"name"`
		AccountEmail string    `json:"account_email,omitempty"`
		Enabled      bool      `json:"enabled"`
		Credentials  *struct {
			AccessToken  string `json:"access_token,omitempty"`
			RefreshToken string `json:"refresh_token,omitempty"`
			Expiry       int64  `json:"expiry,omitempty"`
		} `json:"credentials,omitempty"`
	}

	var exported []ExportedIntegration
	for _, integ := range integrations {
		if integ.Provider != plugins.ProviderGmail {
			continue
		}

		exp := ExportedIntegration{
			ID:       integ.ID,
			Provider: integ.Provider,
			Name:     integ.Name,
			Enabled:  integ.Enabled,
		}

		// Parse credentials from params
		if integ.Params != "" {
			var params struct {
				AccountEmail string `json:"account_email"`
				Creds        struct {
					Token        string `json:"token"`
					RefreshToken string `json:"refresh_token"`
					Expiry       string `json:"expiry"`
				} `json:"creds"`
			}
			if err := json.Unmarshal([]byte(integ.Params), &params); err == nil {
				exp.AccountEmail = params.AccountEmail
				exp.Credentials = &struct {
					AccessToken  string `json:"access_token,omitempty"`
					RefreshToken string `json:"refresh_token,omitempty"`
					Expiry       int64  `json:"expiry,omitempty"`
				}{
					AccessToken:  params.Creds.Token,
					RefreshToken: params.Creds.RefreshToken,
				}
			}
		}

		exported = append(exported, exp)
	}

	c.JSON(http.StatusOK, exported)
}

// userFromCtx is duplicated from oauth.go - consider refactoring
func userFromCtxMobile(ctx context.Context) (*storage.User, error) {
	user, ok := ctx.Value("user").(*storage.User)
	if !ok || user == nil {
		return nil, errors.New("user not found in context")
	}
	return user, nil
}
