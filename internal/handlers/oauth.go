package handlers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"golang.org/x/oauth2"
)

const oauthStateCookieName = "oauthstate"

type OAuth struct {
	configs   map[string]*oauth2.Config
	providers map[string]*oidc.Provider
	db        *storage.Storage
}

func NewOAuth(cfg *config.Config, db *storage.Storage) *OAuth {
	configs := make(map[string]*oauth2.Config)
	providers := make(map[string]*oidc.Provider)
	for providerName, providerCfg := range cfg.OAuth2.Providers {
		provider, err := oidc.NewProvider(context.Background(), providerCfg.IssuerURL)
		if err != nil {
			panic(err)
		}
		providers[providerName] = provider
		configs[providerName] = &oauth2.Config{
			ClientID:     providerCfg.ClientID,
			ClientSecret: providerCfg.ClientSecret,
			RedirectURL:  providerCfg.RedirectURL,
			Scopes:       providerCfg.Scopes,
			Endpoint:     provider.Endpoint(),
		}
	}
	return &OAuth{configs: configs, providers: providers, db: db}
}

func (o *OAuth) Redirect(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	provider := vars["provider"]
	log.Printf("Redirecting to %s for authentication", provider)

	cfg, ok := o.configs[provider]
	if !ok {
		http.Error(w, "unknown oauth provider", http.StatusBadRequest)
		return
	}

	state := generateStateOauthCookie(w)
	url := cfg.AuthCodeURL(state)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

func (o *OAuth) Callback(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	providerName := vars["provider"]
	log.Printf("Callback received from %s", providerName)

	cfg, ok := o.configs[providerName]
	if !ok {
		http.Error(w, "unknown oauth provider", http.StatusBadRequest)
		return
	}

	provider, ok := o.providers[providerName]
	if !ok {
		http.Error(w, "unknown oauth provider", http.StatusBadRequest)
		return
	}

	state, err := r.Cookie(oauthStateCookieName)
	if err != nil || r.FormValue("state") != state.Value {
		http.Error(w, "invalid oauth state", http.StatusBadRequest)
		return
	}

	code := r.FormValue("code")
	token, err := cfg.Exchange(context.Background(), code)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to exchange token: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	idToken, ok := token.Extra("id_token").(string)
	if !ok {
		http.Error(w, "no id_token field in oauth2 token", http.StatusInternalServerError)
		return
	}

	verifier := provider.Verifier(&oidc.Config{ClientID: cfg.ClientID})
	parsedIDToken, err := verifier.Verify(context.Background(), idToken)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to verify ID token: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	var claims struct {
		Email   string `json:"email"`
		Profile string `json:"profile"`
		Sub     string `json:"sub"`
	}
	if err := parsedIDToken.Claims(&claims); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// In a real application, you would have a proper profile management system.
	// For now, we will just generate a random UUID as the profile ID.
	profileID, _ := uuid.NewRandom()

	encryptedToken, err := json.Marshal(token)
	if err != nil {
		http.Error(w, "failed to marshal token", http.StatusInternalServerError)
		return
	}

	oauthToken := &storage.OAuthToken{
		ProfileID:      profileID.String(),
		Provider:       providerName,
		AccountEmail:   claims.Email,
		ExternalUserID: claims.Sub,
		Scopes:         cfg.Scopes,
		TokenEncrypted: encryptedToken,
	}

	if err := o.db.SaveOAuthToken(oauthToken); err != nil {
		http.Error(w, fmt.Sprintf("failed to save token: %s", err.Error()), http.StatusInternalServerError)
		return
	}

	log.Printf("User authenticated: %s", claims.Email)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(claims)
}

func generateStateOauthCookie(w http.ResponseWriter) string {
	b := make([]byte, 16)
	rand.Read(b)
	state := base64.URLEncoding.EncodeToString(b)
	cookie := http.Cookie{Name: oauthStateCookieName, Value: state, MaxAge: 3600}
	http.SetCookie(w, &cookie)
	return state
}
