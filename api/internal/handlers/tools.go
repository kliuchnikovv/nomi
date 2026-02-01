package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/integrations"
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

	// Add Integrations
	// Фильтруем: только серверные интеграции передаются в Python backend
	// Клиентские интеграции (ClientOnly) выполняются локально на устройстве
	for _, integration := range userIntegrations {
		// Проверяем тип интеграции через реестр
		provider, ok := integrations.GetProvider(integration.Provider)
		if !ok {
			h.logger.Warn("provider not found in registry, skipping",
				zap.String("provider", integration.Provider),
			)
			continue
		}

		// Пропускаем клиентские интеграции - они выполняются локально
		if provider.StorageType == integrations.StorageTypeClientOnly {
			h.logger.Debug("skipping client-only integration",
				zap.String("provider", integration.Provider),
			)
			continue
		}

		var params map[string]interface{}
		if integration.Params != "" {
			// Try to unmarshal params if it's a JSON string
			_ = json.Unmarshal([]byte(integration.Params), &params)
		}

		// Use integration.Provider as the tool name (e.g., 'gmail', 'github')
		// This must match the keys expected by Python's ToolConfig
		toolName := integration.Provider
		if toolName == "" {
			toolName = integration.Name
		}

		tools = append(tools, ToolConfig{
			Name:    toolName,
			Enabled: true,
			Params:  params,
		})
	}

	c.JSON(http.StatusOK, tools)
}
