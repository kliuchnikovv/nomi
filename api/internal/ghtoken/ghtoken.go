// Package ghtoken resolves a usable GitHub access token for a user, preferring a
// GitHub App installation token (scoped to the repos the user granted) and
// falling back to a stored OAuth token so existing connections keep working.
package ghtoken

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/crypto"
	"github.com/kliuchnikovv/genie-api/internal/githubapp"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// ForUser returns a GitHub token for the user, or "" if none is available.
// Order: GitHub App installation token (if the app is configured and the user
// has installed it) → stored OAuth token (legacy fallback).
func ForUser(
	ctx context.Context,
	store *storage.Storage,
	ghApp *githubapp.Client,
	cryptoKey []byte,
	userID uuid.UUID,
) string {
	if store == nil {
		return ""
	}

	// Preferred: GitHub App installation token. If the user has installed the
	// app, we use ONLY the installation token (scoped to the repos they granted)
	// and never fall back to the broad OAuth token — a stale OAuth grant would
	// otherwise leak repos (e.g. whole orgs) the user never authorized for the app.
	if ghApp != nil {
		if inst, err := store.GetGitHubInstallationByUser(ctx, userID); err == nil && inst.InstallationID != 0 {
			if tok, _, err := ghApp.InstallationToken(ctx, inst.InstallationID, githubapp.TokenOptions{}); err == nil && tok != "" {
				return tok
			}
			// Installation exists but the token could not be minted this turn.
			// Do NOT fall back to the broad OAuth token; return empty so the
			// caller skips GitHub instead of leaking unauthorized repos.
			return ""
		}
	}

	// Legacy fallback (user has no app installation): stored OAuth token.
	if len(cryptoKey) == 32 {
		if oauthTok, err := store.GetOAuthTokenByUser(ctx, userID, "github"); err == nil {
			if dec, err := crypto.Decrypt(cryptoKey, oauthTok.TokenEncrypted); err == nil {
				var td map[string]any
				if json.Unmarshal(dec, &td) == nil {
					if at, ok := td["access_token"].(string); ok {
						return at
					}
				}
			}
		}
	}

	return ""
}
