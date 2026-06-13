// Package githubapp mints short-lived GitHub App installation access tokens.
//
// A GitHub App authenticates as itself with a JWT (RS256, signed with the app's
// private key), then exchanges that JWT for an installation token scoped to the
// repositories and permissions chosen at install time. Installation tokens live
// ~1h, so we cache them per installation and refresh just before expiry.
package githubapp

import (
	"bytes"
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const githubAPIBase = "https://api.github.com"

// DefaultPermissions is the least-privilege set used for the agent: read code,
// create branches/commits (needed to open a PR), and read/write pull requests.
// Note: GitHub App permissions can't restrict by branch — refusing pushes to the
// default branch and deletions is enforced in the tool layer, not here.
var DefaultPermissions = map[string]string{
	"contents":      "write",
	"pull_requests": "write",
	"metadata":      "read",
}

// TokenOptions narrows an installation token below the installation's own grant.
// Zero value means "use DefaultPermissions, all installed repositories".
type TokenOptions struct {
	// Repositories limits the token to these repo names (not owner/name, just the
	// name). Empty means all repositories the installation can access.
	Repositories []string
	// Permissions overrides DefaultPermissions when non-nil.
	Permissions map[string]string
}

// Client mints installation tokens for a single GitHub App.
type Client struct {
	appID      int64
	privateKey *rsa.PrivateKey
	httpClient *http.Client

	mu    sync.Mutex
	cache map[int64]cachedToken
}

type cachedToken struct {
	token     string
	expiresAt time.Time
}

// NewClient parses the app's private key and returns a ready client. The key may
// be raw PEM, or base64-encoded PEM (convenient for passing a multi-line key
// through a single environment variable without breaking YAML).
func NewClient(appID int64, privateKey string) (*Client, error) {
	if appID == 0 {
		return nil, fmt.Errorf("githubapp: app id is required")
	}
	pemBytes := []byte(privateKey)
	if !strings.Contains(privateKey, "-----BEGIN") {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(privateKey))
		if err != nil {
			return nil, fmt.Errorf("githubapp: private key is neither PEM nor base64: %w", err)
		}
		pemBytes = decoded
	}
	key, err := jwt.ParseRSAPrivateKeyFromPEM(pemBytes)
	if err != nil {
		return nil, fmt.Errorf("githubapp: parse private key: %w", err)
	}
	return &Client{
		appID:      appID,
		privateKey: key,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		cache:      make(map[int64]cachedToken),
	}, nil
}

// appJWT builds the app-level JWT used to authenticate to the GitHub App API.
// iat is backdated 60s to tolerate clock skew; GitHub caps the lifetime at 10m.
func (c *Client) appJWT() (string, error) {
	now := time.Now()
	claims := jwt.RegisteredClaims{
		Issuer:    fmt.Sprintf("%d", c.appID),
		IssuedAt:  jwt.NewNumericDate(now.Add(-60 * time.Second)),
		ExpiresAt: jwt.NewNumericDate(now.Add(9 * time.Minute)),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	return token.SignedString(c.privateKey)
}

// InstallationToken returns a (cached) installation access token for the given
// installation, minting a fresh one when the cache is empty or near expiry.
func (c *Client) InstallationToken(
	ctx context.Context, installationID int64, opts TokenOptions,
) (string, time.Time, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if cached, ok := c.cache[installationID]; ok &&
		time.Until(cached.expiresAt) > 5*time.Minute {
		return cached.token, cached.expiresAt, nil
	}

	token, expiresAt, err := c.mintInstallationToken(ctx, installationID, opts)
	if err != nil {
		return "", time.Time{}, err
	}
	c.cache[installationID] = cachedToken{token: token, expiresAt: expiresAt}
	return token, expiresAt, nil
}

func (c *Client) mintInstallationToken(
	ctx context.Context, installationID int64, opts TokenOptions,
) (string, time.Time, error) {
	appJWT, err := c.appJWT()
	if err != nil {
		return "", time.Time{}, err
	}

	perms := opts.Permissions
	if perms == nil {
		perms = DefaultPermissions
	}
	body := map[string]any{"permissions": perms}
	if len(opts.Repositories) > 0 {
		body["repositories"] = opts.Repositories
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return "", time.Time{}, err
	}

	url := fmt.Sprintf("%s/app/installations/%d/access_tokens", githubAPIBase, installationID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", time.Time{}, err
	}
	req.Header.Set("Authorization", "Bearer "+appJWT)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("githubapp: request installation token: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated {
		return "", time.Time{}, fmt.Errorf(
			"githubapp: installation token request failed (status %d): %s",
			resp.StatusCode, string(respBody),
		)
	}

	var parsed struct {
		Token     string    `json:"token"`
		ExpiresAt time.Time `json:"expires_at"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", time.Time{}, fmt.Errorf("githubapp: decode installation token: %w", err)
	}
	if parsed.Token == "" {
		return "", time.Time{}, fmt.Errorf("githubapp: empty token in response")
	}
	return parsed.Token, parsed.ExpiresAt, nil
}
