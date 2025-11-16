package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/lib/pq"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
	"gorm.io/gorm"
)

const oauthStateCookieName = "oauth_state"

type oauthStatePayload struct {
	UserID string `json:"user_id"`
	Nonce  string `json:"nonce"`
}

type OAuthHandler struct {
	cfg           *config.Config
	storage       *storage.Storage
	oauthConfigs  map[string]*oauth2.Config
	oidcProviders map[string]*oidc.Provider
}

func NewOAuthHandler(
	logger *zap.Logger,
	cfg *config.Config,
	storage *storage.Storage,
) (*OAuthHandler, error) {
	if len(cfg.OAuth2.Providers) == 0 {
		return nil, fmt.Errorf("no oauth providers configured")
	}

	oauthConfigs := make(map[string]*oauth2.Config)
	oidcProviders := make(map[string]*oidc.Provider)
	for name, providerCfg := range cfg.OAuth2.Providers {
		provider, err := oidc.NewProvider(context.Background(), providerCfg.IssuerURL)
		if err != nil {
			return nil, err
		}
		oidcProviders[name] = provider
		redirect := providerCfg.RedirectURL
		if redirect == "" {
			if cfg.OAuth2.CallbackBase == "" {
				return nil, fmt.Errorf("redirect_url missing for provider %s and callback_base unset", name)
			}
			base := strings.TrimSuffix(cfg.OAuth2.CallbackBase, "/")
			redirect = fmt.Sprintf("%s/api/oauth/%s/callback", base, name)
		}
		logger.Info("redirect url", zap.String("url", redirect))
		oauthConfigs[name] = &oauth2.Config{
			ClientID:     providerCfg.ClientID,
			ClientSecret: providerCfg.ClientSecret,
			RedirectURL:  redirect,
			Scopes:       providerCfg.Scopes,
			Endpoint:     provider.Endpoint(),
		}
	}

	return &OAuthHandler{
		cfg:           cfg,
		storage:       storage,
		oauthConfigs:  oauthConfigs,
		oidcProviders: oidcProviders,
	}, nil
}

func (h *OAuthHandler) Login(c *gin.Context) {
	providerName := c.Param("provider")
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	oauthCfg, err := h.providerConfig(providerName)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	state, nonce, err := buildState(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to build state"})
		return
	}

	setOAuthStateCookie(c, nonce, 600)

	authURL := oauthCfg.AuthCodeURL(
		state,
		oauth2.AccessTypeOffline,
		oauth2.ApprovalForce,
		oauth2.SetAuthURLParam("prompt", "consent"),
		oauth2.SetAuthURLParam("include_granted_scopes", "true"),
	)

	c.JSON(http.StatusOK, gin.H{
		"auth_url": authURL,
	})
}

func (h *OAuthHandler) Callback(c *gin.Context) {
	ctx := c.Request.Context()
	providerName := c.Param("provider")
	oauthCfg, err := h.providerConfig(providerName)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	state := c.Query("state")
	if state == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing state"})
		return
	}

	payload, err := parseState(state)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid state"})
		return
	}

	nonceCookie, err := c.Cookie(oauthStateCookieName)
	if err != nil || nonceCookie != payload.Nonce {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid oauth state"})
		return
	}

	setOAuthStateCookie(c, "", -1)

	code := c.Query("code")
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code parameter is required"})
		return
	}

	token, err := oauthCfg.Exchange(context.Background(), code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token exchange failed"})
		return
	}

	oidcProvider, err := h.oidcProvider(providerName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "id_token missing"})
		return
	}

	verifier := oidcProvider.Verifier(&oidc.Config{ClientID: oauthCfg.ClientID})
	idToken, err := verifier.Verify(context.Background(), rawIDToken)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to verify id_token"})
		return
	}

	var claims struct {
		Email string `json:"email"`
		Sub   string `json:"sub"`
	}
	if err := idToken.Claims(&claims); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read claims"})
		return
	}

	userID, err := uuid.Parse(payload.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user"})
		return
	}

	user, err := h.storage.GetUserByID(ctx, userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user not found"})
		return
	}

	tokenBytes, err := json.Marshal(token)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encode token"})
		return
	}

	newToken := &storage.OAuthToken{
		UserID:         user.ID,
		ProfileID:      user.ID.String(),
		Provider:       providerName,
		AccountEmail:   claims.Email,
		ExternalUserID: claims.Sub,
		Scopes:         pq.StringArray(oauthCfg.Scopes),
		TokenEncrypted: tokenBytes,
		Version:        1,
	}

	existing, err := h.storage.GetOAuthTokenByUser(ctx, user.ID, providerName)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if errors.Is(err, gorm.ErrRecordNotFound) {
		if err := h.storage.SaveOAuthToken(ctx, newToken); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save token"})
			return
		}
	} else {
		existing.AccountEmail = newToken.AccountEmail
		existing.ExternalUserID = newToken.ExternalUserID
		existing.TokenEncrypted = newToken.TokenEncrypted
		existing.Scopes = newToken.Scopes
		existing.ProfileID = newToken.ProfileID
		if err := h.storage.UpdateOAuthToken(ctx, existing); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update token"})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("%s account connected", providerName),
		"email":   claims.Email,
	})
}

func (h *OAuthHandler) providerConfig(name string) (*oauth2.Config, error) {
	cfg, ok := h.oauthConfigs[name]
	if !ok {
		return nil, fmt.Errorf("unknown provider %s", name)
	}
	return cfg, nil
}

func (h *OAuthHandler) oidcProvider(name string) (*oidc.Provider, error) {
	provider, ok := h.oidcProviders[name]
	if !ok {
		return nil, fmt.Errorf("unknown provider %s", name)
	}
	return provider, nil
}

func buildState(userID uuid.UUID) (string, string, error) {
	payload := oauthStatePayload{
		UserID: userID.String(),
		Nonce:  uuid.NewString(),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "", "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), payload.Nonce, nil
}

func setOAuthStateCookie(c *gin.Context, value string, maxAge int) {
	secure := c.Request.TLS != nil
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     oauthStateCookieName,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		MaxAge:   maxAge,
		Secure:   secure,
		SameSite: http.SameSiteNoneMode,
	})
}

func parseState(state string) (*oauthStatePayload, error) {
	data, err := base64.RawURLEncoding.DecodeString(state)
	if err != nil {
		return nil, err
	}
	var payload oauthStatePayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, err
	}
	return &payload, nil
}
