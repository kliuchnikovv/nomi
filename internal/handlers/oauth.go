package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

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

const (
	oauthSessionCookieName = "oauth_sid"
)

type OAuthHandler struct {
	cfg           *config.Config
	storage       *storage.Storage
	oauthConfigs  map[string]*oauth2.Config
	oidcProviders map[string]*oidc.Provider
	sessionTTL    time.Duration
}

func NewOAuthHandler(
	logger *zap.Logger,
	cfg *config.Config,
	storage *storage.Storage,
	oauthConfigs map[string]*oauth2.Config,
	oidcProviders map[string]*oidc.Provider,
) (*OAuthHandler, error) {
	var err error
	if oauthConfigs == nil || oidcProviders == nil {
		oauthConfigs, oidcProviders, err = BuildOAuthResources(logger, cfg)
		if err != nil {
			return nil, err
		}
	}

	return &OAuthHandler{
		cfg:           cfg,
		storage:       storage,
		oauthConfigs:  oauthConfigs,
		oidcProviders: oidcProviders,
		sessionTTL:    5 * time.Minute,
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

	if _, err := h.providerConfig(providerName); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	session := &storage.OAuthSession{
		ID:        uuid.New(),
		UserID:    user.ID,
		Provider:  providerName,
		State:     uuid.NewString(),
		ExpiresAt: time.Now().UTC().Add(h.sessionTTL),
	}
	if err := h.storage.CreateOAuthSession(ctx, session); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create oauth session"})
		return
	}

	redirectURL := fmt.Sprintf("%s/api/oauth/%s/redirect?sid=%s", h.cfg.OAuth2.CallbackBase, providerName, session.ID.String())
	c.JSON(http.StatusOK, gin.H{"auth_url": redirectURL})
}

func (h *OAuthHandler) Redirect(c *gin.Context) {
	ctx := c.Request.Context()
	providerName := c.Param("provider")
	sidParam := c.Query("sid")
	sid, err := uuid.Parse(sidParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid session id"})
		return
	}

	session, err := h.storage.GetOAuthSession(ctx, sid)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid oauth session"})
		return
	}
	if session.Provider != providerName {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider mismatch"})
		return
	}
	if time.Now().After(session.ExpiresAt) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "oauth session expired"})
		return
	}

	oauthCfg, err := h.providerConfig(providerName)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	authURL := oauthCfg.AuthCodeURL(
		session.State,
		oauth2.AccessTypeOffline,
		oauth2.ApprovalForce,
		oauth2.SetAuthURLParam("prompt", "consent"),
		oauth2.SetAuthURLParam("include_granted_scopes", "true"),
	)

	setOAuthSessionCookie(c, session.ID.String(), int(h.sessionTTL.Seconds()))
	c.Redirect(http.StatusFound, authURL)
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

	sidCookie, err := c.Cookie(oauthSessionCookieName)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session cookie missing"})
		return
	}

	sid, err := uuid.Parse(sidCookie)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid session cookie"})
		return
	}

	session, err := h.storage.GetOAuthSession(ctx, sid)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "oauth session not found"})
		return
	}
	if session.Provider != providerName {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider mismatch"})
		return
	}
	if time.Now().After(session.ExpiresAt) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "oauth session expired"})
		return
	}
	if session.State != state {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid state"})
		return
	}

	code := c.Query("code")
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code parameter is required"})
		return
	}

	token, err := oauthCfg.Exchange(context.Background(), code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "token exchange failed", "error": err.Error()})
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

	user, err := h.storage.GetUserByID(ctx, session.UserID)
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

	if err := h.storage.DeleteOAuthSession(ctx, session.ID); err != nil {
		// log but continue
	}

	setOAuthSessionCookie(c, "", -1)

	deepLink := fmt.Sprintf("genie://oauth/callback?provider=%s&status=ok&email=%s", providerName, url.QueryEscape(claims.Email))
	c.Redirect(http.StatusFound, deepLink)
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

func setOAuthSessionCookie(c *gin.Context, value string, maxAge int) {
	secure := c.Request.TLS != nil
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     oauthSessionCookieName,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		MaxAge:   maxAge,
		Secure:   secure,
		SameSite: http.SameSiteNoneMode,
	})
}
