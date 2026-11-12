package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"net/url"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/nomi-api/internal/config"
	"github.com/kliuchnikovv/nomi-api/internal/crypto"
	"github.com/kliuchnikovv/nomi-api/internal/integrations"
	"github.com/kliuchnikovv/nomi-api/internal/storage"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
)

// MobileOAuthHandler handles OAuth flows for mobile clients.
// Tokens are stored encrypted server-side in oauth_tokens table.
type MobileOAuthHandler struct {
	cfg          *config.Config
	storage      *storage.Storage
	logger       *zap.Logger
	oauthFactory *integrations.OAuthFactory
	oidcProvider *oidc.Provider
	cryptoKey    []byte // AES-256 key, 32 bytes
}

// MobileOAuthResponse contains data returned to the mobile client after OAuth
// Note: tokens are stored encrypted server-side, not returned to client
type MobileOAuthResponse struct {
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
	cryptoKey []byte,
) (*MobileOAuthHandler, error) {
	// Create OAuth factory from registry
	oauthFactory, err := integrations.NewOAuthFactory(cfg, logger)
	if err != nil {
		return nil, fmt.Errorf("failed to create OAuth factory: %w", err)
	}

	// Get OIDC provider for Google (used for gmail and calendar)
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
		cryptoKey:    cryptoKey,
	}, nil
}

// LoginResponse is returned when starting OAuth flow
type LoginResponse struct {
	AuthURL string `json:"auth_url"`
}

// Callback handles the OAuth callback from Google and redirects to the mobile app.
// GET /api/oauth/:provider/callback
// Redirects to: nomi://oauth/callback?provider=...&code=...
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
		redirectURL := fmt.Sprintf("nomi://oauth/callback?provider=%s&error=%s", providerName, errorParam)
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
	redirectURL := fmt.Sprintf("nomi://oauth/callback?provider=%s&code=%s",
		url.QueryEscape(providerName),
		url.QueryEscape(code))
	c.Redirect(http.StatusFound, redirectURL)
}

// Login returns the OAuth authorization URL for the specified provider.
// POST /api/oauth/:provider/login
// Response: { "auth_url": "..." }
func (h *MobileOAuthHandler) Login(c *gin.Context) {
	providerName := c.Param("provider")

	// Check if the provider exists in the registry
	provider, ok := integrations.GetProvider(providerName)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("provider %s not supported", providerName)})
		return
	}

	// Create OAuth config from registry using its declared default permissions
	oauthConfig, err := h.oauthFactory.BuildOAuthConfig(providerName, provider.DefaultPermissions)
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

	// Check if the provider exists in the registry
	provider, ok := integrations.GetProvider(providerName)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("provider %s not supported", providerName)})
		return
	}

	// Create OAuth config from registry using its declared default permissions
	oauthConfig, err := h.oauthFactory.BuildOAuthConfig(providerName, provider.DefaultPermissions)
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

	h.logger.Info("oauth token exchange result",
		zap.String("provider", providerName),
		zap.Bool("has_access_token", token.AccessToken != ""),
		zap.String("access_token_preview", func() string {
			if token.AccessToken == "" {
				return "EMPTY"
			}
			if len(token.AccessToken) > 20 {
				return token.AccessToken[:20]
			}
			return token.AccessToken
		}()),
		zap.Bool("has_refresh_token", token.RefreshToken != ""),
	)

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

	// Encrypt and save tokens to oauth_tokens table
	type tokenPayload struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token,omitempty"`
		ClientID     string `json:"client_id,omitempty"`
		ClientSecret string `json:"client_secret,omitempty"`
		TokenURI     string `json:"token_uri,omitempty"`
		TokenType    string `json:"token_type,omitempty"`
	}
	payload := tokenPayload{
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		ClientID:     oauthConfig.ClientID,
		ClientSecret: oauthConfig.ClientSecret,
		TokenType:    token.TokenType,
	}
	h.logger.Info("saving oauth token payload",
		zap.String("provider", providerName),
		zap.String("client_id_prefix", func() string {
			if oauthConfig.ClientID == "" {
				return "EMPTY"
			}
			if len(oauthConfig.ClientID) > 20 {
				return oauthConfig.ClientID[:20]
			}
			return oauthConfig.ClientID
		}()),
		zap.Bool("has_client_secret", oauthConfig.ClientSecret != ""),
		zap.Bool("has_refresh_token", token.RefreshToken != ""),
	)
	// The OAuth endpoint (including TokenURL) is owned by the integrations registry.
	payload.TokenURI = oauthConfig.Endpoint.TokenURL

	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		h.logger.Error("failed to marshal token payload", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save credentials"})
		return
	}

	encrypted, err := crypto.Encrypt(h.cryptoKey, payloadJSON)
	if err != nil {
		h.logger.Error("failed to encrypt token", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save credentials"})
		return
	}

	user, err := userFromCtx(c.Request.Context())
	if err != nil || user == nil {
		h.logger.Warn("could not save tokens: user not found in context", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "user not found"})
		return
	}

	oauthToken := &storage.OAuthToken{
		UserID:         user.ID,
		Provider:       providerName,
		AccountEmail:   accountEmail,
		TokenEncrypted: encrypted,
	}
	if err := h.storage.SaveOAuthToken(ctx, oauthToken); err != nil {
		h.logger.Error("failed to save oauth token", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save credentials"})
		return
	}

	// Save integration metadata (no tokens in params)
	metaParams, _ := json.Marshal(map[string]string{"display_name": displayName})
	integration := &storage.Integration{
		UserID:       user.ID,
		Name:         accountEmail,
		Provider:     providerName,
		AccountEmail: accountEmail,
		Params:       string(metaParams),
		Enabled:      true,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	if err := h.storage.UpsertIntegration(integration); err != nil {
		h.logger.Error("failed to upsert integration", zap.Error(err))
	}

	h.logger.Info("mobile OAuth callback successful, tokens saved server-side",
		zap.String("provider", providerName),
		zap.String("email", accountEmail),
	)

	c.JSON(http.StatusOK, MobileOAuthResponse{
		AccountEmail: accountEmail,
		Provider:     providerName,
	})
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

	// Check if the provider exists in the registry
	provider, ok := integrations.GetProvider(req.Provider)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("provider %s not supported", req.Provider)})
		return
	}

	// Create OAuth config from registry using its declared default permissions
	oauthConfig, err := h.oauthFactory.BuildOAuthConfig(req.Provider, provider.DefaultPermissions)
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

// GetAccessToken returns a fresh access token for an authenticated device using
// the refresh token stored server-side at connect time. This is the device-facing
// counterpart to RefreshToken (which requires the caller to supply the refresh
// token, which client-only devices do not hold). Used by the mobile token-refresh
// service for server-backed ("hybrid") Google integrations.
// POST /api/oauth/:provider/access-token
func (h *MobileOAuthHandler) GetAccessToken(c *gin.Context) {
	ctx := c.Request.Context()

	user, err := userFromCtx(ctx)
	if err != nil || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	providerName := c.Param("provider")
	provider, ok := integrations.GetProvider(providerName)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("provider %s not supported", providerName)})
		return
	}

	// Load the encrypted token stored server-side at connect time.
	oauthToken, err := h.storage.GetOAuthTokenByUser(ctx, user.ID, providerName)
	if err != nil || oauthToken == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "oauth token not found - please re-authenticate"})
		return
	}

	decrypted, err := crypto.Decrypt(h.cryptoKey, oauthToken.TokenEncrypted)
	if err != nil {
		h.logger.Error("failed to decrypt token", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to decrypt token"})
		return
	}

	var tokenData map[string]interface{}
	if err := json.Unmarshal(decrypted, &tokenData); err != nil {
		h.logger.Error("failed to parse token data", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse token data"})
		return
	}

	refreshToken, _ := tokenData["refresh_token"].(string)
	if refreshToken == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no refresh token stored - please re-authenticate"})
		return
	}

	oauthConfig, err := h.oauthFactory.BuildOAuthConfig(providerName, provider.DefaultPermissions)
	if err != nil {
		h.logger.Error("failed to build OAuth config", zap.Error(err), zap.String("provider", providerName))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "provider configuration missing"})
		return
	}

	tokenSource := oauthConfig.TokenSource(ctx, &oauth2.Token{RefreshToken: refreshToken})
	newToken, err := tokenSource.Token()
	if err != nil {
		h.logger.Error("token refresh failed", zap.String("provider", providerName), zap.Error(err))
		c.JSON(http.StatusUnauthorized, gin.H{"error": "token refresh failed - please re-authenticate"})
		return
	}

	// Persist the refreshed access token back into the encrypted blob so the
	// server copy stays current (the refresh token is preserved).
	tokenData["access_token"] = newToken.AccessToken
	if !newToken.Expiry.IsZero() {
		tokenData["expiry"] = newToken.Expiry.Format(time.RFC3339)
	}
	if updatedJSON, mErr := json.Marshal(tokenData); mErr == nil {
		if encrypted, eErr := crypto.Encrypt(h.cryptoKey, updatedJSON); eErr == nil {
			oauthToken.TokenEncrypted = encrypted
			if uErr := h.storage.UpdateOAuthToken(ctx, oauthToken); uErr != nil {
				h.logger.Warn("failed to persist refreshed token", zap.Error(uErr))
			}
		}
	}

	c.JSON(http.StatusOK, RefreshTokenResponse{
		AccessToken: newToken.AccessToken,
		TokenExpiry: newToken.Expiry.Unix(),
	})
}

// StoreImapCredentials persists IMAP/SMTP credentials server-side so the brain
// can run email tools without the device. The secret blob (username/password/
// hosts) is encrypted into oauth_tokens (provider="imap"); non-secret host
// metadata is mirrored into the integrations row for discovery.
// POST /api/integrations/imap/credentials
func (h *MobileOAuthHandler) StoreImapCredentials(c *gin.Context) {
	ctx := c.Request.Context()
	userID := c.MustGet("userID").(uuid.UUID)

	var req struct {
		AccountEmail string `json:"account_email"`
		DisplayName  string `json:"display_name"`
		Username     string `json:"username"`
		Password     string `json:"password"`
		ImapHost     string `json:"imap_host"`
		ImapPort     int    `json:"imap_port"`
		ImapUseTLS   bool   `json:"imap_use_tls"`
		SmtpHost     string `json:"smtp_host"`
		SmtpPort     int    `json:"smtp_port"`
		SmtpUseTLS   bool   `json:"smtp_use_tls"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if req.Username == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username and password are required"})
		return
	}
	accountEmail := req.AccountEmail
	if accountEmail == "" {
		accountEmail = req.Username
	}

	creds := map[string]interface{}{
		"username":     req.Username,
		"password":     req.Password,
		"imap_host":    req.ImapHost,
		"imap_port":    req.ImapPort,
		"imap_use_tls": req.ImapUseTLS,
		"smtp_host":    req.SmtpHost,
		"smtp_port":    req.SmtpPort,
		"smtp_use_tls": req.SmtpUseTLS,
		"display_name": req.DisplayName,
		"account_email": accountEmail,
	}
	blob, err := json.Marshal(creds)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encode credentials"})
		return
	}
	encrypted, err := crypto.Encrypt(h.cryptoKey, blob)
	if err != nil {
		h.logger.Error("failed to encrypt imap credentials", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store credentials"})
		return
	}
	if err := h.storage.SaveOAuthToken(ctx, &storage.OAuthToken{
		UserID:         userID,
		Provider:       "imap",
		AccountEmail:   accountEmail,
		TokenEncrypted: encrypted,
	}); err != nil {
		h.logger.Error("failed to save imap credentials", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store credentials"})
		return
	}

	// Mirror non-secret host metadata into the integrations row for discovery.
	hostParams, _ := json.Marshal(map[string]interface{}{
		"imap_host":    req.ImapHost,
		"imap_port":    req.ImapPort,
		"imap_use_tls": req.ImapUseTLS,
		"smtp_host":    req.SmtpHost,
		"smtp_port":    req.SmtpPort,
		"smtp_use_tls": req.SmtpUseTLS,
		"account_email": accountEmail,
	})
	name := req.DisplayName
	if name == "" {
		name = accountEmail
	}
	if err := h.storage.UpsertIntegration(&storage.Integration{
		UserID:       userID,
		Provider:     "imap",
		AccountEmail: accountEmail,
		Name:         name,
		Params:       string(hostParams),
		Enabled:      true,
	}); err != nil {
		h.logger.Warn("failed to upsert imap integration row", zap.Error(err))
	}

	h.logger.Info("stored imap credentials", zap.String("account_email", accountEmail))
	c.JSON(http.StatusOK, gin.H{"status": "ok", "account_email": accountEmail})
}

// UpdateStoredToken updates the access_token in the encrypted oauth_tokens record.
// Called by Python backend after a successful token refresh to persist the new token.
// POST /api/oauth/:provider/update-token
func (h *MobileOAuthHandler) UpdateStoredToken(c *gin.Context) {
	ctx := c.Request.Context()
	providerName := c.Param("provider")

	var req struct {
		UserID       string `json:"user_id"`
		AccountEmail string `json:"account_email"`
		AccessToken  string `json:"access_token"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if req.UserID == "" || req.AccountEmail == "" || req.AccessToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id, account_email, and access_token are required"})
		return
	}

	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id"})
		return
	}

	oauthToken, err := h.storage.GetOAuthTokenByUserAndEmail(ctx, userID, providerName, req.AccountEmail)
	if err != nil {
		h.logger.Warn("oauth token not found for update",
			zap.String("provider", providerName),
			zap.String("account_email", req.AccountEmail),
			zap.Error(err),
		)
		c.JSON(http.StatusNotFound, gin.H{"error": "oauth token not found"})
		return
	}

	decrypted, err := crypto.Decrypt(h.cryptoKey, oauthToken.TokenEncrypted)
	if err != nil {
		h.logger.Error("failed to decrypt token for update", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to decrypt token"})
		return
	}

	var tokenData map[string]interface{}
	if err := json.Unmarshal(decrypted, &tokenData); err != nil {
		h.logger.Error("failed to parse token data for update", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse token data"})
		return
	}

	tokenData["access_token"] = req.AccessToken

	updatedJSON, err := json.Marshal(tokenData)
	if err != nil {
		h.logger.Error("failed to marshal updated token data", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update token"})
		return
	}

	encrypted, err := crypto.Encrypt(h.cryptoKey, updatedJSON)
	if err != nil {
		h.logger.Error("failed to encrypt updated token", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update token"})
		return
	}

	oauthToken.TokenEncrypted = encrypted
	if err := h.storage.UpdateOAuthToken(ctx, oauthToken); err != nil {
		h.logger.Error("failed to update oauth token in db", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save updated token"})
		return
	}

	h.logger.Info("successfully updated stored oauth token",
		zap.String("provider", providerName),
		zap.String("account_email", req.AccountEmail),
	)

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
