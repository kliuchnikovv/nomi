package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/integrations"
	"github.com/kliuchnikovv/genie-api/internal/plugins"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

type ToolsHandler struct {
	store  *storage.Storage
	logger *zap.Logger
}

func NewToolsHandler(store *storage.Storage, logger *zap.Logger) *ToolsHandler {
	return &ToolsHandler{
		store:  store,
		logger: logger,
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
	if err := h.store.DB.Where("user_id = ? AND enabled = ?", userID, true).Find(&userIntegrations).Error; err != nil {
		h.logger.Error("failed to fetch integrations", zap.Error(err))
		// Proceed with default tools even if integrations fail
	}
	h.logger.Info("fetched integrations", zap.Int("count", len(userIntegrations)), zap.String("user_id", userID.String()))

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

		// For server-side tools, store credentials per account id so Python can resolve them.
		if provider.StorageType == integrations.StorageTypeServer || provider.StorageType == integrations.StorageTypeHybrid {
			entry.mergedParams[accountID] = rawParams
		}
	}

	for providerName, entry := range providerMap {
		params := make(map[string]interface{})
		params["accounts"] = entry.accounts

		if entry.provider.StorageType == integrations.StorageTypeServer || entry.provider.StorageType == integrations.StorageTypeHybrid {
			params["credentials"] = entry.mergedParams
		}

		tools = append(tools, ToolConfig{
			Name:    providerName,
			Enabled: true,
			Params:  params,
		})
	}

	// Add Server Plugins (execution.type: server or hybrid)
	for _, manifest := range plugins.Manifests {
		if manifest.Execution.Type != "server" && manifest.Execution.Type != "hybrid" {
			continue
		}
		// Skip if include=false in manifest
		if !manifest.GetInclude() {
			continue
		}
		toolParams := map[string]interface{}{}
		if manifest.Execution.Type == "server" {
			toolParams["user_id"] = userID.String()
		}
		tools = append(tools, ToolConfig{
			Name:    manifest.Name,
			Enabled: true,
			Params:  toolParams,
		})
	}

	c.JSON(http.StatusOK, tools)
}
