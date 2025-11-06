package handlers

// import (
// 	"context"
// 	"crypto/rand"
// 	"encoding/base64"
// 	"encoding/json"
// 	"fmt"
// 	"log"
// 	"net/http"
// 	"strconv"
// 	"strings"
// 	"time"

// 	"github.com/coreos/go-oidc/v3/oidc"
// 	"github.com/google/uuid"
// 	"github.com/gorilla/mux"
// 	"github.com/kliuchnikovv/genie-api/internal/config"
// 	"github.com/kliuchnikovv/genie-api/internal/providers"
// 	"github.com/kliuchnikovv/genie-api/internal/storage"
// 	"github.com/lib/pq"
// 	"golang.org/x/oauth2"
// )

// const oauthStateCookieName = "oauthstate"

// type OAuth struct {
// 	configs   map[string]*oauth2.Config
// 	providers map[string]*oidc.Provider
// 	db        *storage.Storage
// 	cfg       *config.Config
// }

// // PermissionsRequest represents a request to update token scopes
// type PermissionsRequest struct {
// 	Scopes []string `json:"scopes"`
// }

// // ScopeInfo represents a single scope with human-friendly info
// type ScopeInfo struct {
// 	ID    string `json:"id"`
// 	Name  string `json:"name"`
// 	Level string `json:"level"` // read_only|modify
// }

// // GoogleStatusResponse represents connection status for Google
// type GoogleStatusResponse struct {
// 	State        string      `json:"state"`
// 	AccountEmail string      `json:"account_email"`
// 	Scopes       []ScopeInfo `json:"scopes"`
// }

// // PermissionEntry represents a permission for the permissions API
// type PermissionEntry struct {
// 	Category    string `json:"category"`
// 	Title       string `json:"title"`
// 	Description string `json:"description"`
// 	Allowed     bool   `json:"allowed"`
// }

// // LogEntry is a single formatted log entry
// type LogEntry struct {
// 	Summary   string `json:"summary"`
// 	Details   string `json:"details"`
// 	Timestamp string `json:"timestamp"`
// 	Impact    string `json:"impact"`
// }

// // LogsListResponse represents the response for GET /api/logs
// type LogsListResponse struct {
// 	Entries []LogEntry `json:"entries"`
// }

// // PermissionChoice represents a permission decision for OAuth initiation
// type PermissionChoice struct {
// 	Category string  `json:"category"`
// 	Allowed  bool    `json:"allowed"`
// 	Level    *string `json:"level"` // read|write|null
// }

// // GoogleLoginRequest is the request body for Google OAuth login
// type GoogleLoginRequest struct {
// 	Permissions []PermissionChoice `json:"permissions"`
// 	Scopes      []string           `json:"scopes"`
// }

// // GoogleReauthorizeRequest is the request body for reauthorize
// type GoogleReauthorizeRequest struct {
// 	Permissions []PermissionChoice `json:"permissions"`
// }

// // GoogleAuthResponse is the response with authorization URL
// type GoogleAuthResponse struct {
// 	AuthURL string                `json:"auth_url"`
// 	Status  *GoogleStatusResponse `json:"status,omitempty"`
// }

// // OAuthLoginRequest is a generic login body for /oauth/{provider}/login
// type OAuthLoginRequest struct {
// 	ProfileID string   `json:"profile_id"`
// 	Scopes    []string `json:"scopes"`
// }

// // AuthURLResponse is a simple response with an auth URL
// type AuthURLResponse struct {
// 	AuthURL string `json:"auth_url"`
// }

// // MessageResponse is a simple message payload
// type MessageResponse struct {
// 	Message string `json:"message"`
// }

// func NewOAuth(cfg *config.Config, db *storage.Storage) *OAuth {
// 	configs := make(map[string]*oauth2.Config)
// 	providers := make(map[string]*oidc.Provider)
// 	for providerName, providerCfg := range cfg.OAuth2.Providers {
// 		provider, err := oidc.NewProvider(context.Background(), providerCfg.IssuerURL)
// 		if err != nil {
// 			panic(err)
// 		}
// 		providers[providerName] = provider
// 		configs[providerName] = &oauth2.Config{
// 			ClientID:     providerCfg.ClientID,
// 			ClientSecret: providerCfg.ClientSecret,
// 			RedirectURL:  providerCfg.RedirectURL,
// 			Scopes:       providerCfg.Scopes,
// 			Endpoint:     provider.Endpoint(),
// 		}
// 	}
// 	return &OAuth{configs: configs, providers: providers, db: db, cfg: cfg}
// }

// // @Summary Get OAuth token
// // @Description GetToken returns the token for a given profile+provider. If the token is
// // expired or will expire within the configured refresh window, it attempts to
// // refresh the token using the provider config and persists the refreshed token.
// // @Tags oauth
// // @Param profile path string true "Profile ID"
// // @Param provider path string true "Provider"
// // @Success 200 {object} map[string]interface{}
// // @Failure 404 {object} map[string]string
// // @Router /api/api/token/{profile}/{provider} [get]
// func (o *OAuth) GetToken(w http.ResponseWriter, r *http.Request) {
// 	vars := mux.Vars(r)
// 	profileID := vars["profile"]
// 	providerName := vars["provider"]

// 	tokenModel, err := o.db.GetOAuthTokenByProfileProvider(profileID, providerName)
// 	if err != nil {
// 		http.Error(w, "token not found", http.StatusNotFound)
// 		return
// 	}

// 	var t oauth2.Token
// 	if err := json.Unmarshal(tokenModel.TokenEncrypted, &t); err != nil {
// 		http.Error(w, "failed to unmarshal token", http.StatusInternalServerError)
// 		return
// 	}

// 	// decide whether to refresh
// 	refreshWindow := time.Duration(15) * time.Minute
// 	if o.cfg != nil && o.cfg.Token.RefreshBeforeMinutes > 0 {
// 		refreshWindow = time.Duration(o.cfg.Token.RefreshBeforeMinutes) * time.Minute
// 	}

// 	now := time.Now()
// 	needRefresh := t.Expiry.IsZero() || t.Expiry.Before(now.Add(refreshWindow))

// 	if needRefresh {
// 		cfg, ok := o.configs[providerName]
// 		if !ok {
// 			http.Error(w, "unknown oauth provider", http.StatusBadRequest)
// 			return
// 		}

// 		ts := cfg.TokenSource(context.Background(), &t)
// 		newToken, err := ts.Token()
// 		if err != nil {
// 			http.Error(w, "failed to refresh token: "+err.Error(), http.StatusInternalServerError)
// 			return
// 		}

// 		b, err := json.Marshal(newToken)
// 		if err != nil {
// 			http.Error(w, "failed to marshal refreshed token", http.StatusInternalServerError)
// 			return
// 		}

// 		tokenModel.TokenEncrypted = b
// 		tokenModel.UpdatedAt = time.Now()
// 		if err := o.db.UpdateOAuthToken(tokenModel); err != nil {
// 			http.Error(w, "failed to persist refreshed token", http.StatusInternalServerError)
// 			return
// 		}

// 		t = *newToken
// 	}

// 	w.Header().Set("Content-Type", "application/json")
// 	json.NewEncoder(w).Encode(t)
// }

// // Disconnect removes stored token (soft delete) for profile+provider
// func (o *OAuth) Disconnect(w http.ResponseWriter, r *http.Request) {
// 	vars := mux.Vars(r)
// 	profileID := vars["profile"]
// 	providerName := vars["provider"]

// 	if err := o.db.DeleteOAuthTokenByProfileProvider(profileID, providerName); err != nil {
// 		http.Error(w, "failed to delete token", http.StatusInternalServerError)
// 		return
// 	}
// 	w.WriteHeader(http.StatusNoContent)
// }

// // @Summary Log integration usage
// // @Description Record an integration usage log entry
// // @Tags logs
// // @Accept json
// // @Param log body storage.IntegrationLog true "Integration log entry"
// // @Success 204
// // @Failure 400 {object} map[string]string
// // @Router /api/api/logs [post]
// // LogUsage accepts a usage log entry and persists it.
// func (o *OAuth) LogUsage(w http.ResponseWriter, r *http.Request) {
// 	var lg storage.IntegrationLog
// 	if err := json.NewDecoder(r.Body).Decode(&lg); err != nil {
// 		http.Error(w, "invalid log body", http.StatusBadRequest)
// 		return
// 	}
// 	if lg.Timestamp.IsZero() {
// 		lg.Timestamp = time.Now()
// 	}
// 	if err := o.db.SaveIntegrationLog(&lg); err != nil {
// 		http.Error(w, "failed to save log", http.StatusInternalServerError)
// 		return
// 	}
// 	w.WriteHeader(http.StatusNoContent)
// }

// // @Summary Update token permissions (scopes)
// // @Description Update scopes for a stored token (permissions)
// // @Tags oauth
// // @Accept json
// // @Param profile path string true "Profile ID"
// // @Param provider path string true "Provider"
// // @Param body body PermissionsRequest true "Scopes to set"
// // @Success 204
// // @Failure 400 {object} map[string]string
// // @Failure 404 {object} map[string]string
// // @Router /api/api/permissions/{profile}/{provider} [put]
// // UpdatePermissions updates the scopes for a stored token and persists it.
// func (o *OAuth) UpdatePermissions(w http.ResponseWriter, r *http.Request) {
// 	vars := mux.Vars(r)
// 	profileID := vars["profile"]
// 	providerName := vars["provider"]

// 	var body struct {
// 		Scopes []string `json:"scopes"`
// 	}
// 	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
// 		http.Error(w, "invalid body", http.StatusBadRequest)
// 		return
// 	}

// 	tokenModel, err := o.db.GetOAuthTokenByProfileProvider(profileID, providerName)
// 	if err != nil {
// 		http.Error(w, "token not found", http.StatusNotFound)
// 		return
// 	}
// 	tokenModel.Scopes = pq.StringArray(body.Scopes)
// 	if err := o.db.UpdateOAuthToken(tokenModel); err != nil {
// 		http.Error(w, "failed to update scopes", http.StatusInternalServerError)
// 		return
// 	}
// 	w.WriteHeader(http.StatusNoContent)
// }

// // @Summary Update OAuth token
// // @Description UpdateToken replaces/stores token JSON for given profile+provider. The
// // client should POST/PUT an oauth2.Token JSON body.
// // @Tags oauth
// // @Param profile path string true "Profile ID"
// // @Param provider path string true "Provider"
// // @Accept json
// // @Success 204
// // @Failure 400 {object} map[string]string
// // @Router /api/api/token/{profile}/{provider} [put]
// func (o *OAuth) UpdateToken(w http.ResponseWriter, r *http.Request) {
// 	vars := mux.Vars(r)
// 	profileID := vars["profile"]
// 	providerName := vars["provider"]

// 	var t oauth2.Token
// 	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
// 		http.Error(w, "invalid token body", http.StatusBadRequest)
// 		return
// 	}

// 	b, err := json.Marshal(&t)
// 	if err != nil {
// 		http.Error(w, "failed to marshal token", http.StatusInternalServerError)
// 		return
// 	}

// 	// try to find existing
// 	tokenModel, err := o.db.GetOAuthTokenByProfileProvider(profileID, providerName)
// 	if err != nil {
// 		// create new
// 		tokenModel = &storage.OAuthToken{
// 			ProfileID:      profileID,
// 			Provider:       providerName,
// 			AccountEmail:   "",
// 			ExternalUserID: "",
// 			Scopes:         nil,
// 			TokenEncrypted: b,
// 		}
// 		if err := o.db.SaveOAuthToken(tokenModel); err != nil {
// 			http.Error(w, "failed to save token", http.StatusInternalServerError)
// 			return
// 		}
// 	} else {
// 		tokenModel.TokenEncrypted = b
// 		if err := o.db.UpdateOAuthToken(tokenModel); err != nil {
// 			http.Error(w, "failed to update token", http.StatusInternalServerError)
// 			return
// 		}
// 	}

// 	w.WriteHeader(http.StatusNoContent)
// }

// // StatusGoogle returns the connection status and scopes for Google
// // StatusGoogle
// // @Summary Get Google connection status
// // @Description Returns connection state, account email and scope list
// // @Tags oauth
// // @Param profile path string true "Profile ID"
// // @Produce json
// // @Success 200 {object} GoogleStatusResponse
// // @Router /api/api/status/{profile}/google [get]
// func (o *OAuth) StatusGoogle(w http.ResponseWriter, r *http.Request) {
// 	vars := mux.Vars(r)
// 	profileID := vars["profile"]

// 	tokenModel, err := o.db.GetOAuthTokenByProfileProvider(profileID, "google")
// 	resp := GoogleStatusResponse{}
// 	if err != nil || tokenModel == nil {
// 		resp.State = "disconnected"
// 		w.Header().Set("Content-Type", "application/json")
// 		json.NewEncoder(w).Encode(resp)
// 		return
// 	}

// 	resp.State = "connected"
// 	resp.AccountEmail = tokenModel.AccountEmail
// 	for _, s := range tokenModel.Scopes {
// 		level := "modify"
// 		if strings.Contains(strings.ToLower(s), "readonly") {
// 			level = "read_only"
// 		}
// 		resp.Scopes = append(resp.Scopes, ScopeInfo{ID: s, Name: s, Level: level})
// 	}
// 	w.Header().Set("Content-Type", "application/json")
// 	json.NewEncoder(w).Encode(resp)
// }

// // GetPermissionsGoogle returns categorized permission info for Google
// // @Summary List Google permissions
// // @Description Returns permissions per category for the Google integration
// // @Tags oauth
// // @Param profile path string true "Profile ID"
// // @Produce json
// // @Success 200 {array} PermissionEntry
// // @Router /api/api/permissions/{profile}/google [get]
// func (o *OAuth) GetPermissionsGoogle(w http.ResponseWriter, r *http.Request) {
// 	vars := mux.Vars(r)
// 	profileID := vars["profile"]
// 	tokenModel, _ := o.db.GetOAuthTokenByProfileProvider(profileID, "google")
// 	scopes := map[string]bool{}
// 	if tokenModel != nil {
// 		for _, s := range tokenModel.Scopes {
// 			scopes[s] = true
// 		}
// 	}

// 	// Simple mapping by category keywords
// 	var list []PermissionEntry
// 	list = append(list, PermissionEntry{Category: "gmail", Title: "Gmail access", Description: "Read/modify Gmail data", Allowed: hasAny(scopes, "gmail")})
// 	list = append(list, PermissionEntry{Category: "calendar", Title: "Calendar access", Description: "Read/modify Calendar events", Allowed: hasAny(scopes, "calendar")})
// 	list = append(list, PermissionEntry{Category: "drive", Title: "Drive access", Description: "Read/modify Drive files", Allowed: hasAny(scopes, "drive")})
// 	list = append(list, PermissionEntry{Category: "sheets", Title: "Sheets access", Description: "Read/modify Sheets", Allowed: hasAny(scopes, "sheets")})

// 	w.Header().Set("Content-Type", "application/json")
// 	json.NewEncoder(w).Encode(list)
// }

// func hasAny(sc map[string]bool, substr string) bool {
// 	for k := range sc {
// 		if strings.Contains(strings.ToLower(k), substr) {
// 			return true
// 		}
// 	}
// 	return false
// }

// // ListLogs returns integration logs filtered by profile, provider and limit
// // @Summary List integration logs
// // @Tags logs
// // @Produce json
// // @Param profile query string false "Profile ID"
// // @Param provider query string false "Provider (default: google)"
// // @Param limit query int false "Max entries (default: 50)"
// // @Success 200 {object} LogsListResponse
// // @Router /api/api/logs [get]
// func (o *OAuth) ListLogs(w http.ResponseWriter, r *http.Request) {
// 	q := r.URL.Query()
// 	profile := q.Get("profile")
// 	provider := q.Get("provider")
// 	if provider == "" {
// 		provider = "google"
// 	}
// 	limit := 50
// 	if v := q.Get("limit"); v != "" {
// 		if n, err := fmt.Sscanf(v, "%d", &limit); n == 1 && err == nil {
// 			// ok
// 		} else {
// 			// fallback to Atoi for robustness
// 			if n2, err2 := strconv.Atoi(v); err2 == nil {
// 				limit = n2
// 			}
// 		}
// 	}

// 	logs, err := o.db.ListIntegrationLogs(profile, provider, limit)
// 	if err != nil {
// 		http.Error(w, "failed to list logs", http.StatusInternalServerError)
// 		return
// 	}
// 	var resp LogsListResponse
// 	for _, lg := range logs {
// 		details := string(lg.Details)
// 		impact := "info"
// 		if strings.Contains(strings.ToLower(lg.Action), "error") {
// 			impact = "error"
// 		}
// 		resp.Entries = append(resp.Entries, LogEntry{
// 			Summary:   lg.Action,
// 			Details:   details,
// 			Timestamp: lg.Timestamp.UTC().Format(time.RFC3339),
// 			Impact:    impact,
// 		})
// 	}
// 	w.Header().Set("Content-Type", "application/json")
// 	json.NewEncoder(w).Encode(resp)
// }

// // DisconnectGooglePost provides POST variant for disconnect
// // @Summary Disconnect Google
// // @Tags oauth
// // @Param profile path string true "Profile ID"
// // @Success 204
// // @Router /api/api/disconnect/{profile}/google [post]
// func (o *OAuth) DisconnectGooglePost(w http.ResponseWriter, r *http.Request) {
// 	vars := mux.Vars(r)
// 	profileID := vars["profile"]
// 	if err := o.db.DeleteOAuthTokenByProfileProvider(profileID, "google"); err != nil {
// 		http.Error(w, "failed to delete token", http.StatusInternalServerError)
// 		return
// 	}
// 	w.WriteHeader(http.StatusNoContent)
// }

// // OAuthGoogleLogin starts oauth flow; accepts permissions and scopes
// // @Summary Start Google OAuth login
// // @Tags oauth
// // @Accept json
// // @Produce json
// // @Param profile query string true "Profile ID"
// // @Param body body GoogleLoginRequest false "Requested permissions and scopes"
// // @Success 200 {object} GoogleAuthResponse
// // @Router /api/api/oauth/google/login [post]
// func (o *OAuth) OAuthGoogleLogin(w http.ResponseWriter, r *http.Request) {
// 	provider := "google"
// 	cfg, ok := o.configs[provider]
// 	if !ok {
// 		http.Error(w, "unknown oauth provider", http.StatusBadRequest)
// 		return
// 	}
// 	// parse body
// 	var body GoogleLoginRequest
// 	_ = json.NewDecoder(r.Body).Decode(&body)

// 	var scopes []string
// 	for _, s := range body.Scopes {
// 		scopes = append(scopes, providers.GetGoogleScope(s)...)
// 	}

// 	if len(scopes) > 0 {
// 		cookie := http.Cookie{Name: "oauth_scopes", Value: strings.Join(scopes, " "), MaxAge: 3600}
// 		http.SetCookie(w, &cookie)
// 	}

// 	resp := GoogleAuthResponse{
// 		AuthURL: cfg.AuthCodeURL(
// 			generateStateOauthCookie(w),
// 			oauth2.SetAuthURLParam("scope", strings.Join(scopes, " ")),
// 			oauth2.SetAuthURLParam("prompt", "consent"),
// 			oauth2.SetAuthURLParam("access_type", "offline"),
// 			oauth2.SetAuthURLParam("include_granted_scopes", "true"),
// 		),
// 	}
// 	w.Header().Set("Content-Type", "application/json")
// 	json.NewEncoder(w).Encode(resp)
// }

// // OAuthGoogleReauthorize is similar to login but returns only auth_url
// // @Summary Reauthorize Google OAuth
// // @Tags oauth
// // @Accept json
// // @Produce json
// // @Param profile query string true "Profile ID"
// // @Param body body GoogleReauthorizeRequest false "Requested permissions"
// // @Success 200 {object} GoogleAuthResponse
// // @Router /api/api/oauth/google/reauthorize [post]
// func (o *OAuth) OAuthGoogleReauthorize(w http.ResponseWriter, r *http.Request) {
// 	provider := "google"
// 	cfg, ok := o.configs[provider]
// 	if !ok {
// 		http.Error(w, "unknown oauth provider", http.StatusBadRequest)
// 		return
// 	}
// 	var body GoogleReauthorizeRequest
// 	_ = json.NewDecoder(r.Body).Decode(&body)

// 	authURL := cfg.AuthCodeURL(
// 		generateStateOauthCookie(w),
// 		oauth2.SetAuthURLParam("prompt", "consent"),
// 		oauth2.SetAuthURLParam("access_type", "offline"),
// 		oauth2.SetAuthURLParam("include_granted_scopes", "true"),
// 	)
// 	w.Header().Set("Content-Type", "application/json")
// 	json.NewEncoder(w).Encode(GoogleAuthResponse{AuthURL: authURL})
// }

// // Redirect starts a generic OAuth flow
// // @Summary Start OAuth login (generic)
// // @Description Returns provider authorization URL based on requested scopes
// // @Tags oauth
// // @Accept json
// // @Produce json
// // @Param provider path string true "Provider"
// // @Param body body OAuthLoginRequest false "Requested scopes"
// // @Success 200 {object} AuthURLResponse
// // @Failure 400 {object} map[string]string
// // @Failure 500 {object} map[string]string
// // @Router /api/oauth/{provider}/login [post]
// func (o *OAuth) Redirect(w http.ResponseWriter, r *http.Request) {
// 	vars := mux.Vars(r)
// 	provider := vars["provider"]
// 	log.Printf("Redirecting to %s for authentication", provider)

// 	cfg, ok := o.configs[provider]
// 	if !ok {
// 		http.Error(w, "unknown oauth provider", http.StatusBadRequest)
// 		return
// 	}

// 	var redirectBody OAuthLoginRequest
// 	_ = json.NewDecoder(r.Body).Decode(&redirectBody)

// 	var scopes = make([]string, 0, len(redirectBody.Scopes))
// 	for _, scope := range redirectBody.Scopes {
// 		scopes = append(scopes,
// 			// TODO: method may be different for non-google
// 			providers.GetGoogleScope(scope)...,
// 		)
// 	}

// 	if len(scopes) > 0 {
// 		// store requested scopes in a cookie so Callback can read them
// 		cookie := http.Cookie{
// 			Name: "oauth_scopes",
// 			// TODO: delimiter may be different for non-google
// 			Value:  strings.Join(scopes, " "),
// 			MaxAge: 3600,
// 		}
// 		http.SetCookie(w, &cookie)
// 	}

// 	w.Header().Set("Content-Type", "application/json")
// 	json.NewEncoder(w).Encode(AuthURLResponse{
// 		AuthURL: cfg.AuthCodeURL(
// 			generateStateOauthCookie(w),
// 			oauth2.SetAuthURLParam("scope", strings.Join(scopes, " ")), // <-- важно
// 			oauth2.SetAuthURLParam("prompt", "consent"),                // для форс-ре-консента
// 			oauth2.SetAuthURLParam("access_type", "offline"),           // для refresh_token (Google)
// 			oauth2.SetAuthURLParam("include_granted_scopes", "true"),
// 		),
// 	})
// }

// // Callback handles generic OAuth callback for a provider
// // @Summary OAuth callback
// // @Description Exchanges code for token, verifies ID token and persists token
// // @Tags oauth
// // @Produce json
// // @Param provider path string true "Provider"
// // @Success 200 {object} MessageResponse
// // @Failure 400 {object} map[string]string
// // @Failure 500 {object} map[string]string
// // @Router /api/oauth/{provider}/callback [get]
// func (o *OAuth) Callback(w http.ResponseWriter, r *http.Request) {
// 	vars := mux.Vars(r)
// 	providerName := vars["provider"]
// 	log.Printf("Callback received from %s", providerName)

// 	cfg, ok := o.configs[providerName]
// 	if !ok {
// 		http.Error(w, "unknown oauth provider", http.StatusBadRequest)
// 		return
// 	}

// 	provider, ok := o.providers[providerName]
// 	if !ok {
// 		http.Error(w, "unknown oauth provider", http.StatusBadRequest)
// 		return
// 	}

// 	log.Printf("raw query: %s", r.URL.RawQuery)
// 	if err := r.ParseForm(); err == nil {
// 		log.Printf("form: %v", r.Form)
// 	}

// 	state, err := r.Cookie(oauthStateCookieName)
// 	if err != nil || r.FormValue("state") != state.Value {
// 		http.Error(w, "invalid oauth state", http.StatusBadRequest)
// 		return
// 	}

// 	code := r.FormValue("code")
// 	token, err := cfg.Exchange(context.Background(), code)
// 	if err != nil {
// 		http.Error(w, fmt.Sprintf("failed to exchange token: %s", err.Error()), http.StatusInternalServerError)
// 		return
// 	}

// 	idToken, ok := token.Extra("id_token").(string)
// 	if !ok {
// 		http.Error(w, "no id_token field in oauth2 token", http.StatusInternalServerError)
// 		return
// 	}

// 	verifier := provider.Verifier(&oidc.Config{ClientID: cfg.ClientID})
// 	parsedIDToken, err := verifier.Verify(context.Background(), idToken)
// 	if err != nil {
// 		http.Error(w, fmt.Sprintf("failed to verify ID token: %s", err.Error()), http.StatusInternalServerError)
// 		return
// 	}

// 	var claims struct {
// 		Email   string `json:"email"`
// 		Profile string `json:"profile"`
// 		Sub     string `json:"sub"`
// 	}
// 	if err := parsedIDToken.Claims(&claims); err != nil {
// 		http.Error(w, err.Error(), http.StatusInternalServerError)
// 		return
// 	}

// 	// In a real application, you would have a proper profile management system.
// 	// For now, we will just generate a random UUID as the profile ID.
// 	profileID, _ := uuid.NewRandom()

// 	// Determine scopes requested by client (via cookie set during Redirect)
// 	var scopes []string
// 	if sc, err := r.Cookie("oauth_scopes"); err == nil && sc.Value != "" {
// 		scopes = strings.Split(sc.Value, " ")
// 	} else {
// 		scopes = cfg.Scopes
// 	}

// 	encryptedToken, err := json.Marshal(token)
// 	if err != nil {
// 		http.Error(w, "failed to marshal token", http.StatusInternalServerError)
// 		return
// 	}

// 	oauthToken := &storage.OAuthToken{
// 		ProfileID:      profileID.String(),
// 		Provider:       providerName,
// 		AccountEmail:   claims.Email,
// 		ExternalUserID: claims.Sub,
// 		Scopes:         pq.StringArray(scopes),
// 		TokenEncrypted: encryptedToken,
// 	}

// 	if err := o.db.SaveOAuthToken(oauthToken); err != nil {
// 		http.Error(w, fmt.Sprintf("failed to save token: %s", err.Error()), http.StatusInternalServerError)
// 		return
// 	}

// 	log.Printf("User authenticated: %s", claims.Email)
// 	w.Header().Set("Content-Type", "application/json")
// 	json.NewEncoder(w).Encode(MessageResponse{Message: "Google account connected successfully."})
// }

// func generateStateOauthCookie(w http.ResponseWriter) string {
// 	b := make([]byte, 16)
// 	rand.Read(b)
// 	state := base64.URLEncoding.EncodeToString(b)
// 	cookie := http.Cookie{Name: oauthStateCookieName, Value: state, MaxAge: 3600}
// 	http.SetCookie(w, &cookie)
// 	return state
// }
