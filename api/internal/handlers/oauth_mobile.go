package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2"
)

// MobileOAuthHandler handles OAuth callbacks for mobile clients
type MobileOAuthHandler struct {
	configs map[string]*oauth2.Config
}

func NewMobileOAuthHandler(configs map[string]*oauth2.Config) *MobileOAuthHandler {
	return &MobileOAuthHandler{
		configs: configs,
	}
}

type MobileOAuthResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenExpiry  int64  `json:"token_expiry"`
	AccountEmail string `json:"account_email"`
	Provider     string `json:"provider"`
}

// HandleCallback performs token exchange and returns tokens to the client
func (h *MobileOAuthHandler) HandleCallback(c *gin.Context) {
	provider := c.Param("provider")
	config, ok := h.configs[provider]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid provider"})
		return
	}

	var req struct {
		Code string `json:"code"`
	}
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	token, err := config.Exchange(context.Background(), req.Code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to exchange token", "details": err.Error()})
		return
	}

	email := ""
	// idToken, ok := token.Extra("id_token").(string)
	// if ok {
	// 	// Placeholder extract
	// 	email = "extracted-from-id-token"
	// }

	resp := MobileOAuthResponse{
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		TokenExpiry:  token.Expiry.Unix(),
		AccountEmail: email,
		Provider:     provider,
	}

	c.JSON(http.StatusOK, resp)
}

// HandleRefresh performs token refresh using backend secrets
func (h *MobileOAuthHandler) HandleRefresh(c *gin.Context) {
	var req struct {
		Provider     string `json:"provider"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	config, ok := h.configs[req.Provider]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid provider"})
		return
	}

	token := &oauth2.Token{
		RefreshToken: req.RefreshToken,
		Expiry: time.Now().Add(-1 * time.Hour),
	}

	tokenSource := config.TokenSource(context.Background(), token)
	newToken, err := tokenSource.Token()
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Failed to refresh token", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"access_token":  newToken.AccessToken,
		"refresh_token": newToken.RefreshToken,
		"expires_in":    newToken.Expiry.Sub(time.Now()).Seconds(),
		"token_expiry":  newToken.Expiry.Unix(),
	})
}
