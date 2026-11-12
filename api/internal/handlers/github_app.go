package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/nomi-api/internal/config"
	"github.com/kliuchnikovv/nomi-api/internal/storage"
	"go.uber.org/zap"
)

// GitHubAppHandler drives the GitHub App installation flow: hand the user an
// install URL carrying a signed state, then on the post-install redirect map the
// returned installation_id back to our user and persist it.
type GitHubAppHandler struct {
	logger    *zap.Logger
	cfg       *config.Config
	store     *storage.Storage
	jwtSecret []byte
}

func NewGitHubAppHandler(logger *zap.Logger, cfg *config.Config, store *storage.Storage) *GitHubAppHandler {
	return &GitHubAppHandler{
		logger:    logger,
		cfg:       cfg,
		store:     store,
		jwtSecret: []byte(cfg.Token.JWTSecret),
	}
}

const ghAppStatePurpose = "gh_app_install"

// signState mints a short-lived token binding the install flow to our user.
func (h *GitHubAppHandler) signState(userID uuid.UUID) (string, error) {
	claims := jwt.MapClaims{
		"user_id": userID.String(),
		"purpose": ghAppStatePurpose,
		"exp":     time.Now().Add(10 * time.Minute).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(h.jwtSecret)
}

func (h *GitHubAppHandler) parseState(state string) (uuid.UUID, error) {
	tok, err := jwt.Parse(state, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return h.jwtSecret, nil
	})
	if err != nil || !tok.Valid {
		return uuid.Nil, fmt.Errorf("invalid state: %w", err)
	}
	claims, ok := tok.Claims.(jwt.MapClaims)
	if !ok || claims["purpose"] != ghAppStatePurpose {
		return uuid.Nil, fmt.Errorf("invalid state claims")
	}
	uidStr, _ := claims["user_id"].(string)
	return uuid.Parse(uidStr)
}

// Install returns the GitHub App installation URL for the authenticated user.
// GET /api/integrations/github/app/install
func (h *GitHubAppHandler) Install(c *gin.Context) {
	if h.cfg.GitHub.AppSlug == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "GitHub App is not configured"})
		return
	}
	userID := c.MustGet("userID").(uuid.UUID)

	state, err := h.signState(userID)
	if err != nil {
		h.logger.Error("failed to sign github app state", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start installation"})
		return
	}

	installURL := fmt.Sprintf(
		"https://github.com/apps/%s/installations/new?state=%s",
		h.cfg.GitHub.AppSlug, state,
	)
	c.JSON(http.StatusOK, gin.H{"install_url": installURL})
}

// Callback handles GitHub's post-install redirect (Setup URL / Callback URL).
// It is public — the user is identified by the signed `state`, not an auth header.
// GET /api/integrations/github/app/callback?installation_id=..&setup_action=..&state=..
func (h *GitHubAppHandler) Callback(c *gin.Context) {
	setupAction := c.Query("setup_action")
	state := c.Query("state")
	installationIDStr := c.Query("installation_id")

	// User cancelled or removed the installation — nothing to persist.
	if setupAction != "" && setupAction != "install" && setupAction != "update" {
		c.Redirect(http.StatusFound, "nomi://oauth/callback?provider=github&status=cancelled")
		return
	}

	userID, err := h.parseState(state)
	if err != nil {
		h.logger.Warn("github app callback: bad state", zap.Error(err))
		c.Redirect(http.StatusFound, "nomi://oauth/callback?provider=github&error=invalid_state")
		return
	}

	installationID, err := strconv.ParseInt(installationIDStr, 10, 64)
	if err != nil || installationID == 0 {
		h.logger.Warn("github app callback: missing installation_id",
			zap.String("raw", installationIDStr))
		c.Redirect(http.StatusFound, "nomi://oauth/callback?provider=github&error=missing_installation")
		return
	}

	ctx := c.Request.Context()
	if err := h.store.SaveGitHubInstallation(ctx, &storage.GitHubAppInstallation{
		UserID:         userID,
		InstallationID: installationID,
	}); err != nil {
		h.logger.Error("failed to save github installation", zap.Error(err))
		c.Redirect(http.StatusFound, "nomi://oauth/callback?provider=github&error=save_failed")
		return
	}

	// Mark the GitHub integration connected so the agent/UI include it.
	params, _ := json.Marshal(map[string]any{"installation_id": installationID})
	if err := h.store.UpsertIntegration(&storage.Integration{
		UserID:   userID,
		Name:     "GitHub",
		Provider: "github",
		Params:   string(params),
		Enabled:  true,
	}); err != nil {
		h.logger.Error("failed to upsert github integration", zap.Error(err))
		// Installation is saved; surface success anyway — integration row is best-effort.
	}

	h.logger.Info("github app installed",
		zap.String("user_id", userID.String()),
		zap.Int64("installation_id", installationID))

	c.Redirect(http.StatusFound, "nomi://oauth/callback?provider=github&status=installed")
}
