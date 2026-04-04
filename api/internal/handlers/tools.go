package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/crypto"
	"github.com/kliuchnikovv/genie-api/internal/integrations"
	"github.com/kliuchnikovv/genie-api/internal/plugins"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

type ToolsHandler struct {
	store     *storage.Storage
	logger    *zap.Logger
	cryptoKey []byte
}

func NewToolsHandler(store *storage.Storage, logger *zap.Logger, cryptoKey []byte) *ToolsHandler {
	return &ToolsHandler{
		store:     store,
		logger:    logger,
		cryptoKey: cryptoKey,
	}
}

// ListTools returns the list of enabled tools for the current session/user
func (h *ToolsHandler) ListTools(c *gin.Context) {
	sessionID := c.Query("session_id")
	userIDStr := c.Query("user_id") // Add support for direct user_id lookup

	var userID uuid.UUID

	if userIDStr != "" {
		// 1a. Use provided UserID directly
		var err error
		userID, err = uuid.Parse(userIDStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id format"})
			return
		}
	} else if sessionID != "" {
		// 1b. Resolve Session (Chat) to get UserID
		chatUUID, err := uuid.Parse(sessionID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid session_id format"})
			return
		}

		var chat storage.Chat
		if err := h.store.DB.First(&chat, "id = ?", chatUUID).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
				return
			}
			h.logger.Error("failed to fetch chat for tools", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}
		userID = chat.UserID
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session_id or user_id is required"})
		return
	}

	// 2. Fetch User to check settings (e.g. WebSearchEnabled)
	user, err := h.store.GetUserByID(c.Request.Context(), userID)
	if err != nil {
		h.logger.Error("failed to fetch user for tools", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch user"})
		return
	}

	// 3. Fetch Integrations
	var userIntegrations []storage.Integration

	// First, log ALL integrations (including disabled ones)
	var allIntegrations []storage.Integration
	h.store.DB.Where("user_id = ?", userID).Find(&allIntegrations)
	h.logger.Info("ALL integrations for user", zap.Int("count", len(allIntegrations)), zap.String("user_id", userID.String()))
	for _, integration := range allIntegrations {
		h.logger.Info("all integration",
			zap.String("name", integration.Name),
			zap.String("provider", integration.Provider),
			zap.String("account_email", integration.AccountEmail),
			zap.Bool("enabled", integration.Enabled),
		)
	}

	// Now get only enabled ones
	if err := h.store.DB.Where("user_id = ? AND enabled = ?", userID, true).Find(&userIntegrations).Error; err != nil {
		h.logger.Error("failed to fetch integrations", zap.Error(err))
		// Proceed with default tools even if integrations fail
	}
	h.logger.Info("fetched ENABLED integrations", zap.Int("count", len(userIntegrations)), zap.String("user_id", userID.String()))

	// Also check OAuth tokens
	var oauthTokens []storage.OAuthToken
	if err := h.store.DB.Where("user_id = ?", userID).Find(&oauthTokens).Error; err != nil {
		h.logger.Error("failed to fetch oauth tokens", zap.Error(err))
	} else {
		h.logger.Info("OAuth tokens found", zap.Int("count", len(oauthTokens)), zap.String("user_id", userID.String()))
		for _, token := range oauthTokens {
			h.logger.Info("OAuth token",
				zap.String("provider", token.Provider),
				zap.String("account_email", token.AccountEmail),
			)
		}
	}

	// 4. Build Response
	type ToolConfig struct {
		Name    string                 `json:"name"`
		Enabled bool                   `json:"enabled"`
		Params  map[string]interface{} `json:"params,omitempty"`
	}

	var tools []ToolConfig

	// Add Standard Tools based on user preferences
	// Web Search
	if user.WebSearchEnabled {
		tools = append(tools, ToolConfig{Name: "web_search", Enabled: true})
	}

	// Knowledge Base (RAG) - Default enabled for Agents
	// We could parameterize this, but generally agents need access to knowledge.
	tools = append(tools, ToolConfig{
		Name:    "knowledge_search",
		Enabled: true,
		Params: map[string]interface{}{
			"user_id": userID.String(),
		},
	})

	// AccountInfo holds per-account identity for multi-account support.
	type AccountInfo struct {
		ID          string `json:"id"`
		DisplayName string `json:"display_name,omitempty"`
	}

	// Group integrations by provider so that multiple accounts of the same provider
	// are exposed as a single tool with an "accounts" list.
	type providerEntry struct {
		provider     *integrations.ProviderDefinition
		accounts     []AccountInfo
		mergedParams map[string]interface{} // server-side credentials keyed by account id
	}
	providerMap := make(map[string]*providerEntry)

	for _, integration := range userIntegrations {
		h.logger.Info("processing integration",
			zap.String("name", integration.Name),
			zap.String("provider", integration.Provider),
			zap.String("account_email", integration.AccountEmail),
			zap.Bool("enabled", integration.Enabled),
		)

		provider, ok := integrations.GetProvider(integration.Provider)
		if !ok {
			h.logger.Warn("provider not found in registry, skipping",
				zap.String("provider", integration.Provider),
			)
			continue
		}

		var rawParams map[string]interface{}
		if integration.Params != "" {
			if err := json.Unmarshal([]byte(integration.Params), &rawParams); err != nil {
				h.logger.Warn("failed to unmarshal integration params, skipping credentials",
					zap.String("integration_id", integration.ID.String()),
					zap.String("provider", integration.Provider),
					zap.Error(err),
				)
			}
		}

		// Prefer the dedicated account_email column; fall back to params.
		displayName := integration.AccountEmail
		if displayName == "" {
			displayName, _ = rawParams["display_name"].(string)
		}
		if displayName == "" {
			displayName, _ = rawParams["account_email"].(string)
		}

		accountID := integration.ID.String()
		account := AccountInfo{
			ID:          accountID,
			DisplayName: displayName,
		}

		entry, exists := providerMap[integration.Provider]
		if !exists {
			entry = &providerEntry{
				provider:     provider,
				mergedParams: make(map[string]interface{}),
			}
			providerMap[integration.Provider] = entry
		}
		entry.accounts = append(entry.accounts, account)

		// For server-side tools, load credentials from oauth_tokens (encrypted)
		if provider.StorageType == integrations.StorageTypeServer || provider.StorageType == integrations.StorageTypeHybrid {
			oauthToken, err := h.store.GetOAuthTokenByUserAndEmail(
				c.Request.Context(), userID, integration.Provider, integration.AccountEmail,
			)
			if err != nil {
				h.logger.Warn("oauth token not found for integration, skipping credentials",
					zap.String("provider", integration.Provider),
					zap.String("account_email", integration.AccountEmail),
					zap.Error(err),
				)
			} else {
				decrypted, err := crypto.Decrypt(h.cryptoKey, oauthToken.TokenEncrypted)
				if err != nil {
					h.logger.Warn("failed to decrypt oauth token",
						zap.String("provider", integration.Provider),
						zap.String("account_email", integration.AccountEmail),
						zap.Error(err),
					)
				} else {
					var tokenData map[string]interface{}
					if err := json.Unmarshal(decrypted, &tokenData); err == nil {
						entry.mergedParams[accountID] = tokenData
						h.logger.Info("loaded credentials for integration",
							zap.String("provider", integration.Provider),
							zap.String("account_id", accountID),
							zap.Bool("has_access_token", tokenData["access_token"] != nil),
						)
					} else {
						h.logger.Warn("failed to unmarshal oauth token",
							zap.String("provider", integration.Provider),
							zap.String("account_id", accountID),
							zap.Error(err),
						)
					}
				}
			}
		}
	}

	for providerName, entry := range providerMap {
		params := make(map[string]interface{})
		params["accounts"] = entry.accounts

		if entry.provider.StorageType == integrations.StorageTypeServer || entry.provider.StorageType == integrations.StorageTypeHybrid {
			params["credentials"] = entry.mergedParams
			h.logger.Info("sending credentials for provider",
				zap.String("provider", providerName),
				zap.Int("num_accounts", len(entry.accounts)),
				zap.Int("num_credential_entries", len(entry.mergedParams)),
				zap.Strings("account_ids", func() []string {
					ids := make([]string, 0, len(entry.accounts))
					for _, a := range entry.accounts {
						ids = append(ids, a.ID)
					}
					return ids
				}()),
				zap.Strings("credential_keys", func() []string {
					keys := make([]string, 0, len(entry.mergedParams))
					for k := range entry.mergedParams {
						keys = append(keys, k)
					}
					return keys
				}()),
			)
		}

		tools = append(tools, ToolConfig{
			Name:    providerName,
			Enabled: true,
			Params:  params,
		})
	}

	// Build a map of OAuth config key → first available decrypted credentials.
	// This lets server plugins that share an OAuth provider (e.g. calendar + gmail
	// both use oauth_config_key "google") reuse credentials from an already-enabled
	// integration even when the plugin itself has no dedicated integration entry.
	oauthKeyCredentials := make(map[string]map[string]interface{})
	for _, integration := range userIntegrations {
		provider, ok := integrations.GetProvider(integration.Provider)
		if !ok || provider.OAuthConfigKey == "" {
			continue
		}
		if _, alreadyFound := oauthKeyCredentials[provider.OAuthConfigKey]; alreadyFound {
			continue
		}
		oauthToken, err := h.store.GetOAuthTokenByUserAndEmail(
			c.Request.Context(), userID, integration.Provider, integration.AccountEmail,
		)
		if err != nil {
			continue
		}
		decrypted, err := crypto.Decrypt(h.cryptoKey, oauthToken.TokenEncrypted)
		if err != nil {
			continue
		}
		var tokenData map[string]interface{}
		if err := json.Unmarshal(decrypted, &tokenData); err == nil {
			oauthKeyCredentials[provider.OAuthConfigKey] = tokenData
		}
	}

	// Add Server Plugins (execution.type: server or hybrid)
	// Only add if not already present from integrations (to avoid overwriting credentials)
	for _, manifest := range plugins.Manifests {
		if manifest.Execution.Type != "server" && manifest.Execution.Type != "hybrid" {
			continue
		}
		// Skip if include=false in manifest
		if !manifest.GetInclude() {
			continue
		}
		// Skip if this provider is already in providerMap (already added from integrations)
		if _, exists := providerMap[manifest.Name]; exists {
			continue
		}
		toolParams := map[string]interface{}{}
		if manifest.Execution.Type == "server" {
			toolParams["user_id"] = userID.String()
		}

		// If the plugin uses a shared OAuth provider, try to inject credentials from
		// any integration that already has a valid token for that OAuth config key.
		if def, ok := integrations.GetProvider(manifest.Name); ok && def.OAuthConfigKey != "" {
			if creds, found := oauthKeyCredentials[def.OAuthConfigKey]; found {
				toolParams["creds"] = creds
			}
		}

		tools = append(tools, ToolConfig{
			Name:    manifest.Name,
			Enabled: true,
			Params:  toolParams,
		})
	}

	// Add Client-only Plugins (execution.type: client)
	// Client-only integrations are stored in local SQLite on the device and never synced
	// to the server DB. We auto-include them here so the discovery tool can route to them.
	// Execution happens on the device via client_action WebSocket frames; permissions
	// are checked at execution time by the client executor.
	for _, manifest := range plugins.Manifests {
		if manifest.Execution.Type != "client" {
			continue
		}
		// Skip if include=false in manifest
		if !manifest.GetInclude() {
			continue
		}
		// Skip if this provider is already in providerMap (already added from integrations)
		if _, exists := providerMap[manifest.Name]; exists {
			continue
		}
		tools = append(tools, ToolConfig{
			Name:    manifest.Name,
			Enabled: true,
			Params:  map[string]interface{}{},
		})
	}

	c.JSON(http.StatusOK, tools)
}
