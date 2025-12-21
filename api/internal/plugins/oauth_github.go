package plugins

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/lib/pq"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"
	"gorm.io/gorm"
)

const (
	ProviderGitHub = "github"
)

// GitHubIntegration handles OAuth for GitHub and persists tokens/integration config.
type GitHubIntegration struct {
	cfg         *config.Config
	storage     *storage.Storage
	logger      *zap.Logger
	oauthConfig *oauth2.Config
}

func NewGitHubIntegration(
	logger *zap.Logger,
	cfg *config.Config,
	store *storage.Storage,
) (*GitHubIntegration, error) {
	providerCfg, ok := cfg.OAuth2.Providers["github"]
	if !ok {
		return nil, fmt.Errorf("github provider config not found")
	}

	// GitHub OAuth scopes for basic user info and repo access
	scopes := []string{"user:email", "read:user"}

	oauthConfig := &oauth2.Config{
		ClientID:     providerCfg.ClientID,
		ClientSecret: providerCfg.ClientSecret,
		RedirectURL:  fmt.Sprintf("%s/api/oauth/%s/callback", cfg.OAuth2.CallbackBase, ProviderGitHub),
		Scopes:       scopes,
		Endpoint:     github.Endpoint,
	}

	return &GitHubIntegration{
		cfg:         cfg,
		storage:     store,
		logger:      logger,
		oauthConfig: oauthConfig,
	}, nil
}

func (g *GitHubIntegration) GetAuthURL(state string) string {
	return g.oauthConfig.AuthCodeURL(
		state,
		oauth2.AccessTypeOffline,
	)
}

// gitHubUser represents the user info from GitHub API
type gitHubUser struct {
	Login string `json:"login"`
	Email string `json:"email"`
	ID    int64  `json:"id"`
}

func (g *GitHubIntegration) HandleCallback(ctx context.Context, code string, user *storage.User) (string, error) {
	token, err := g.oauthConfig.Exchange(ctx, code)
	if err != nil {
		return "", fmt.Errorf("token exchange failed: %w", err)
	}

	// Fetch user info from GitHub API
	ghUser, err := g.fetchGitHubUser(ctx, token.AccessToken)
	if err != nil {
		return "", fmt.Errorf("failed to fetch github user: %w", err)
	}

	// Use login as fallback if email is not public
	email := ghUser.Email
	if email == "" {
		email = ghUser.Login + "@users.noreply.github.com"
	}

	tokenBytes, err := json.Marshal(token)
	if err != nil {
		return "", fmt.Errorf("failed to encode token: %w", err)
	}

	newToken := &storage.OAuthToken{
		UserID:         user.ID,
		ProfileID:      user.ID.String(),
		Provider:       ProviderGitHub,
		AccountEmail:   email,
		ExternalUserID: fmt.Sprintf("%d", ghUser.ID),
		Scopes:         pq.StringArray(g.oauthConfig.Scopes),
		TokenEncrypted: tokenBytes,
		Version:        1,
	}

	existing, err := g.storage.GetOAuthTokenByUserAndEmail(ctx, user.ID, ProviderGitHub, email)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", fmt.Errorf("failed to check existing token: %w", err)
	}

	if errors.Is(err, gorm.ErrRecordNotFound) {
		if err := g.storage.SaveOAuthToken(ctx, newToken); err != nil {
			return "", fmt.Errorf("failed to save token: %w", err)
		}
	} else {
		existing.AccountEmail = newToken.AccountEmail
		existing.ExternalUserID = newToken.ExternalUserID
		existing.TokenEncrypted = newToken.TokenEncrypted
		existing.Scopes = newToken.Scopes
		existing.ProfileID = newToken.ProfileID
		if err := g.storage.UpdateOAuthToken(ctx, existing); err != nil {
			return "", fmt.Errorf("failed to update token: %w", err)
		}
	}

	params := map[string]any{
		"account_email": email,
		"username":      ghUser.Login,
		"creds": map[string]any{
			"token":         token.AccessToken,
			"refresh_token": token.RefreshToken,
			"token_type":    token.TokenType,
			"expiry":        token.Expiry,
		},
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
		if t.Provider == ProviderGitHub {
			accountEmail, _ := extractGitHubAccountEmail(t.Params)
			if accountEmail == email {
				existingTool = &t
				break
			}
		}
	}

	if existingTool != nil {
		existingTool.Params = string(paramsJSON)
		existingTool.Name = fmt.Sprintf("GitHub (%s)", ghUser.Login)
		if _, err := g.storage.UpdateIntegration(ctx, user.ID, existingTool); err != nil {
			return "", fmt.Errorf("failed to update integration: %w", err)
		}
	} else {
		newTool := &storage.Integration{
			UserID:   user.ID,
			Name:     fmt.Sprintf("GitHub (%s)", ghUser.Login),
			Provider: ProviderGitHub,
			Params:   string(paramsJSON),
			Enabled:  true,
		}
		if _, err := g.storage.CreateIntegration(ctx, user.ID, newTool); err != nil {
			return "", fmt.Errorf("failed to create integration: %w", err)
		}
	}

	return email, nil
}

func (g *GitHubIntegration) fetchGitHubUser(ctx context.Context, accessToken string) (*gitHubUser, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("github api error: %s", string(body))
	}

	var user gitHubUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, err
	}

	return &user, nil
}

func extractGitHubAccountEmail(params string) (string, error) {
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
