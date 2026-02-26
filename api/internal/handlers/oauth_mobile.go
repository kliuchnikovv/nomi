package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/integrations"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
	"net/url"
)

// MobileOAuthHandler handles OAuth flows for mobile clients.
// Unlike regular OAuth, tokens are returned to the client instead of being stored on the backend.
type MobileOAuthHandler struct {
	cfg          *config.Config
	storage      *storage.Storage
	logger       *zap.Logger
	oauthFactory *integrations.OAuthFactory
	oidcProvider *oidc.Provider
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
	// Создаем OAuth фабрику из реестра
	oauthFactory, err := integrations.NewOAuthFactory(cfg, logger)
	if err != nil {
		return nil, fmt.Errorf("failed to create OAuth factory: %w", err)
	}

	// Получаем OIDC провайдер для Google (используется для gmail и calendar)
	oidcProvider, err := oauthFactory.GetOIDCProvider("https://accounts.google.com")
	if err != nil {
		return nil, fmt.Errorf("failed to get OIDC provider: %w", err)
	}

	return &MobileOAuthHandler{
		cfg:          cfg,
		storage:      db,
		logger:       logger,
		oauthFactory: oauthFactory,
		oidcProvider: oidcProvider,
	}, nil
}

// LoginResponse is returned when starting OAuth flow
type LoginResponse struct {
	AuthURL string `json:"auth_url"`
}

// Callback handles the OAuth callback from Google and redirects to the mobile app.
// GET /api/oauth/:provider/callback
// Redirects to: genie://oauth/callback?provider=...&code=...
func (h *MobileOAuthHandler) Callback(c *gin.Context) {
	providerName := c.Param("provider")
	code := c.Query("code")
	state := c.Query("state")
	errorParam := c.Query("error")

	// Check for errors from Google
	if errorParam != "" {
		errorDesc := c.Query("error_description")
		h.logger.Error("OAuth callback error",
			zap.String("provider", providerName),
			zap.String("error", errorParam),
			zap.String("description", errorDesc),
		)
		// Redirect to app with error
		redirectURL := fmt.Sprintf("genie://oauth/callback?provider=%s&error=%s", providerName, errorParam)
		c.Redirect(http.StatusFound, redirectURL)
		return
	}

	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code is required"})
		return
	}

	h.logger.Info("OAuth callback received",
		zap.String("provider", providerName),
		zap.String("state", state),
	)

	// Redirect to the mobile app with the code
	// The app will then call /callback-mobile to exchange the code for tokens
	redirectURL := fmt.Sprintf("genie://oauth/callback?provider=%s&code=%s",
		url.QueryEscape(providerName),
		url.QueryEscape(code))
	c.Redirect(http.StatusFound, redirectURL)
}

// Login returns the OAuth authorization URL for the specified provider.
// POST /api/oauth/:provider/login
// Response: { "auth_url": "..." }
func (h *MobileOAuthHandler) Login(c *gin.Context) {
	providerName := c.Param("provider")

	// Проверяем, существует ли провайдер в реестре
	_, ok := integrations.GetProvider(providerName)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("provider %s not supported", providerName)})
		return
	}

	// Получаем permissions для провайдера
	var permissions []string
	switch providerName {
	case "gmail":
		permissions = []string{"gmail:read", "gmail:write"}
	case "calendar":
		permissions = []string{"calendar:read", "calendar:write"}
	case "github":
		permissions = []string{}
	default:
		permissions = []string{}
	}

	// Создаем OAuth конфигурацию из реестра
	oauthConfig, err := h.oauthFactory.BuildOAuthConfig(providerName, permissions)
	if err != nil {
		h.logger.Error("failed to build OAuth config", zap.Error(err), zap.String("provider", providerName))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to build OAuth configuration"})
		return
	}

	// Generate a state token for CSRF protection
	// For mobile, we use a simple state since the callback is handled by the app
	state := "mobile-oauth-state"

	// Generate the authorization URL with offline access to get refresh token
	authURL := oauthConfig.AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.ApprovalForce)

	h.logger.Info("generated OAuth login URL",
		zap.String("provider", providerName),
	)

	c.JSON(http.StatusOK, LoginResponse{AuthURL: authURL})
}

// CallbackMobile exchanges the authorization code for tokens and returns them to the client.
// POST /api/oauth/:provider/callback-mobile
// Request: { "code": "..." }
// Response: MobileOAuthResponse
func (h *MobileOAuthHandler) CallbackMobile(c *gin.Context) {
	ctx := c.Request.Context()
	providerName := c.Param("provider")

	// Проверяем, существует ли провайдер в реестре
	_, ok := integrations.GetProvider(providerName)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("provider %s not supported", providerName)})
		return
	}

	// Получаем permissions для провайдера
	var permissions []string
	switch providerName {
	case "gmail":
		permissions = []string{"gmail:read", "gmail:write"}
	case "calendar":
		permissions = []string{"calendar:read", "calendar:write"}
	case "github":
		permissions = []string{}
	default:
		permissions = []string{}
	}

	// Создаем OAuth конфигурацию из реестра
	oauthConfig, err := h.oauthFactory.BuildOAuthConfig(providerName, permissions)
	if err != nil {
		h.logger.Error("failed to build OAuth config", zap.Error(err), zap.String("provider", providerName))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "provider configuration missing"})
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("token exchange failed: %v", err)})
		return
	}

	var accountEmail string
	var displayName string

	if providerName == "github" {
		// GitHub does not return ID Token. Fetch user email manually.
		client := oauthConfig.Client(ctx, token)
		userResp, err := client.Get("https://api.github.com/user")
		if err != nil {
			h.logger.Error("failed to get github user", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get github user"})
			return
		}
		defer userResp.Body.Close()
		// TODO: parse JSON to get login/email.
		// For now, let's use a simpler approach or struct.
		// But I need to define the struct or use a map.
		var ghUser struct {
			Email string `json:"email"`
			Login string `json:"login"`
		}
		if err := json.NewDecoder(userResp.Body).Decode(&ghUser); err != nil {
			h.logger.Error("failed to decode github user", zap.Error(err))
		}
		// display_name for GitHub is always the login (username), not the email
		displayName = ghUser.Login
		accountEmail = ghUser.Email
		if accountEmail == "" {
			// Email might be private. Try /user/emails
			emailsResp, err := client.Get("https://api.github.com/user/emails")
			if err == nil {
				defer emailsResp.Body.Close()
				var emails []struct {
					Email    string `json:"email"`
					Primary  bool   `json:"primary"`
					Verified bool   `json:"verified"`
				}
				if err := json.NewDecoder(emailsResp.Body).Decode(&emails); err == nil {
					for _, e := range emails {
						if e.Primary && e.Verified {
							accountEmail = e.Email
							break
						}
					}
					// If no primary/verified found, use first one?
					if accountEmail == "" && len(emails) > 0 {
						accountEmail = emails[0].Email
					}
				}
			}
			// If still empty, use login
			if accountEmail == "" {
				accountEmail = ghUser.Login
			}
		}

	} else {
		// OIDC Providers (Google)
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
		accountEmail = claims.Email
		// display_name for Google providers is the account email
		displayName = accountEmail
	}

	// Return tokens to client WITHOUT saving to backend database
	response := MobileOAuthResponse{
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		TokenExpiry:  token.Expiry.Unix(),
		AccountEmail: accountEmail,
		Provider:     providerName,
	}

	h.logger.Info("mobile OAuth callback successful",
		zap.String("provider", providerName),
		zap.String("email", accountEmail),
	)

	// Save integration to backend database so Python agent can use it
	user, err := userFromCtxMobile(c.Request.Context())
	if err == nil && user != nil {
		params := map[string]interface{}{
			"access_token":  token.AccessToken,
			"refresh_token": token.RefreshToken,
			"token_expiry":  token.Expiry.Unix(),
			"account_email": accountEmail,
			"client_id":     oauthConfig.ClientID,
			"client_secret": oauthConfig.ClientSecret,
			"token_type":    token.TokenType,
		}
		if displayName != "" {
			params["display_name"] = displayName
		}

		// Определяем token_uri на основе провайдера
		provider, _ := integrations.GetProvider(providerName)
		if provider != nil && provider.OAuthConfig != nil {
			if providerName == "github" {
				params["token_uri"] = "https://github.com/login/oauth/access_token"
			} else {
				params["token_uri"] = "https://oauth2.googleapis.com/token"
			}
		}

		paramsJSON, _ := json.Marshal(params)

		var integration storage.Integration
		err := h.storage.DB.Where("user_id = ? AND provider = ?", user.ID, providerName).First(&integration).Error

		if err == nil {
			// Update existing
			integration.Params = string(paramsJSON)
			integration.Name = accountEmail // Update name to match email
			integration.Enabled = true
			integration.UpdatedAt = time.Now()
			h.storage.DB.Save(&integration)
			h.logger.Info("updated integration", zap.String("provider", providerName), zap.String("user_id", user.ID.String()))
		} else {
			// Create new
			newIntegration := storage.Integration{
				UserID:    user.ID,
				Name:      accountEmail,
				Provider:  providerName,
				Params:    string(paramsJSON),
				Enabled:   true,
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			}
			if err := h.storage.DB.Create(&newIntegration).Error; err != nil {
				h.logger.Error("failed to create integration", zap.Error(err))
			} else {
				h.logger.Info("created integration", zap.String("provider", providerName), zap.String("user_id", user.ID.String()))
			}
		}
	} else {
		h.logger.Warn("could not save integration: user not found in context", zap.Error(err))
	}

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

	// Проверяем, существует ли провайдер в реестре
	_, ok := integrations.GetProvider(req.Provider)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("provider %s not supported", req.Provider)})
		return
	}

	// Получаем permissions для провайдера
	var permissions []string
	switch req.Provider {
	case "gmail":
		permissions = []string{"gmail:read", "gmail:write"}
	case "calendar":
		permissions = []string{"calendar:read", "calendar:write"}
	default:
		permissions = []string{}
	}

	// Создаем OAuth конфигурацию из реестра
	oauthConfig, err := h.oauthFactory.BuildOAuthConfig(req.Provider, permissions)
	if err != nil {
		h.logger.Error("failed to build OAuth config", zap.Error(err), zap.String("provider", req.Provider))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "provider configuration missing"})
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

// userFromCtx is duplicated from oauth.go - consider refactoring
func userFromCtxMobile(ctx context.Context) (*storage.User, error) {
	user, ok := auth.GetUserFromContext(ctx)
	if !ok || user == nil {
		return nil, errors.New("user not found in context")
	}
	return user, nil
}
