package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/kliuchnikovv/genie-api/internal/credentials"
	"github.com/kliuchnikovv/genie-api/internal/hub"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

type StreamHandler struct {
	hub       *hub.Hub
	logger    *zap.Logger
	store     *storage.Storage
	credStore credentials.Store
}

func NewStreamHandler(
	logger *zap.Logger,
	hub *hub.Hub,
	store *storage.Storage,
	credStore credentials.Store,
) *StreamHandler {
	return &StreamHandler{
		hub:       hub,
		logger:    logger.With(zap.String("handler", "stream")),
		store:     store,
		credStore: credStore,
	}
}

func (h *StreamHandler) ChatWS(c *gin.Context) {
	var ctx = c.Request.Context()
	user, _ := userFromCtx(ctx)
	if user == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "can't find user info in context"})
		return
	}

	h.logger.Info("client connected to websocket", zap.String("user_id", user.ID.String()))

	// Resolve Chat ID and Room Type
	var chatID uuid.UUID
	var roomType hub.RoomType = hub.RoomTypeChat

	// Check if this is a user channel request
	channel := c.Query("channel")
	if channel == "user" {
		chatID = user.ID
		roomType = hub.RoomTypeUser
		h.logger.Info("connecting to user notification channel", zap.String("user_id", user.ID.String()))
	} else {
		// Normal Chat Logic
		chatIDStr := c.Query("chat_id")
		if chatIDStr == "" {
			chatIDStr = c.Query("chatId")
		}

		if chatIDStr != "" {
			if id, err := uuid.Parse(chatIDStr); err == nil {
				chatID = id
			} else {
				h.logger.Warn("invalid chat_id format", zap.String("chat_id", chatIDStr))
			}
		}

		// Security check: verify user owns the chat
		if chatID != uuid.Nil {
			if _, err := h.store.GetChat(ctx, user.ID, chatID); err != nil {
				h.logger.Warn("user attempted to access invalid/unauthorized chat",
					zap.String("user_id", user.ID.String()),
					zap.String("chat_id", chatID.String()),
					zap.Error(err))
				c.JSON(http.StatusForbidden, gin.H{"error": "chat not found or access denied"})
				return
			}
		} else {
			// If no chat_id provided, generate one.
			// New chat session.
			chatID = uuid.New()
			h.logger.Info("no chat_id provided, generated new session_id", zap.String("session_id", chatID.String()))
		}
	}

	// Extract team mode params from query
	mode := c.Query("mode")
	if mode == "" {
		mode = "agent" // Default to agent mode
	}
	command := c.Query("command")
	if command == "" {
		command = c.Query("team")
	}

	// Enrich command with user integrations (Jules API key for development_team)
	if mode == "team" && command != "" {
		command = h.enrichCommandWithIntegrations(user.ID, command)
	}

	h.logger.Info("websocket params",
		zap.String("mode", mode),
		zap.Bool("has_command", command != ""),
		zap.String("room_type", string(roomType)))

	h.hub.ServeWs(c.Writer, c.Request, chatID, roomType, user, mode, command)
}

// enrichCommandWithIntegrations adds user's integration credentials to the command
// It checks both PostgreSQL (OAuth) and Redis (API keys) for credentials
func (h *StreamHandler) enrichCommandWithIntegrations(userID uuid.UUID, command string) string {
	ctx := context.Background()

	// Parse existing command
	var cmdData map[string]interface{}
	if err := json.Unmarshal([]byte(command), &cmdData); err != nil {
		h.logger.Warn("failed to parse command for enrichment", zap.Error(err))
		return command
	}

	// Check if this is development_team
	teamType, _ := cmdData["type"].(string)
	if teamType != "development_team" {
		return command
	}

	// First check Redis for API key (new approach)
	credData, err := h.credStore.Get(ctx, userID, "jules", credentials.DefaultTTL)
	if err == nil && credData.Type == credentials.CredentialTypeAPIKey && credData.APIKey != "" {
		cmdData["jules_api_key"] = credData.APIKey
		h.logger.Info("added Jules API key from Redis to command",
			zap.String("user_id", userID.String()))
	} else {
		// Fallback: Get Jules integration from PostgreSQL (legacy approach)
		var julesIntegration storage.Integration
		if err := h.store.DB.Where("user_id = ? AND provider = ? AND enabled = ?", userID, "jules", true).First(&julesIntegration).Error; err == nil {
			// Parse params to get api_key
			var params map[string]string
			if err := json.Unmarshal([]byte(julesIntegration.Params), &params); err == nil {
				if apiKey, ok := params["api_key"]; ok && apiKey != "" {
					cmdData["jules_api_key"] = apiKey
					h.logger.Info("added Jules API key from DB to command (legacy)",
						zap.String("user_id", userID.String()))
				}
			}
		}
	}

	// Check all enabled integrations from PostgreSQL
	// This handles OAuth tokens that remain in PostgreSQL (per plan)
	var integrations []storage.Integration
	if err := h.store.DB.Where("user_id = ? AND enabled = ?", userID, true).Find(&integrations).Error; err == nil {
		for _, integration := range integrations {
			provider := integration.Provider
			if provider == "jules" {
				continue // Already handled above
			}

			// Check if we already have credentials in Redis for this provider
			hasRedisCreds := false
			providers, _ := h.credStore.ListProviders(ctx, userID)
			for _, p := range providers {
				if p == provider {
					hasRedisCreds = true
					break
				}
			}

			if hasRedisCreds {
				continue // Redis credentials will be added in the loop below
			}

			// Parse params from PostgreSQL
			var params map[string]interface{}
			if err := json.Unmarshal([]byte(integration.Params), &params); err != nil {
				continue
			}

			// Extract OAuth tokens from PostgreSQL
			if accessToken, ok := params["access_token"].(string); ok && accessToken != "" {
				cmdData[provider+"_access_token"] = accessToken
				h.logger.Info("found access_token in PostgreSQL, enriching command", zap.String("provider", provider))
				refreshToken := ""
				if rt, ok := params["refresh_token"].(string); ok && rt != "" {
					refreshToken = rt
					cmdData[provider+"_refresh_token"] = refreshToken
				}
				// Also save to Redis for future use with TTL
				if redisStore, ok := h.credStore.(*credentials.RedisStore); ok {
					if tokenExpiry, ok := params["token_expiry"].(float64); ok {
						expiresAt := time.Unix(int64(tokenExpiry), 0)
						_ = redisStore.SaveOAuth(ctx, userID, provider, accessToken, refreshToken, &expiresAt, credentials.DefaultTTL)
					} else {
						_ = redisStore.SaveOAuth(ctx, userID, provider, accessToken, refreshToken, nil, credentials.DefaultTTL)
					}
				}
				h.logger.Info("added OAuth tokens from PostgreSQL to command",
					zap.String("provider", provider),
					zap.String("user_id", userID.String()))
			}
		}
	}

	// Check other server-side integrations in Redis
	providers, err := h.credStore.ListProviders(ctx, userID)
	if err == nil {
		for _, provider := range providers {
			credData, err := h.credStore.Get(ctx, userID, provider, credentials.DefaultTTL)
			if err != nil {
				continue
			}

			// Add credentials to command based on type
			if credData.Type == credentials.CredentialTypeAPIKey && credData.APIKey != "" {
				cmdData[provider+"_api_key"] = credData.APIKey
				h.logger.Info("added API key to command",
					zap.String("provider", provider),
					zap.String("user_id", userID.String()))
			} else if credData.Type == credentials.CredentialTypeOAuth {
				cmdData[provider+"_access_token"] = credData.AccessToken
				if credData.RefreshToken != "" {
					cmdData[provider+"_refresh_token"] = credData.RefreshToken
				}
				h.logger.Info("added OAuth tokens to command",
					zap.String("provider", provider),
					zap.String("user_id", userID.String()))
			}
		}
	}

	// Re-serialize command
	enriched, err := json.Marshal(cmdData)
	if err != nil {
		h.logger.Error("failed to marshal enriched command", zap.Error(err))
		return command
	}

	return string(enriched)
}

// ClientToolResultRequest is the body for POST /api/chat/client-tool-result (round-trip proxy tools).
type ClientToolResultRequest struct {
	SessionID string `json:"session_id" binding:"required"`
	CallID    string `json:"call_id" binding:"required"`
	Result    string `json:"result"`
}

// ClientToolResult receives client tool execution result and publishes to Redis for Python worker.
func (h *StreamHandler) ClientToolResult(c *gin.Context) {
	ctx := c.Request.Context()
	if _, err := userFromCtx(ctx); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req ClientToolResultRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body: session_id and call_id required"})
		return
	}

	if err := h.hub.PublishClientToolResult(ctx, req.SessionID, req.CallID, req.Result); err != nil {
		h.logger.Error("failed to publish client tool result",
			zap.String("session_id", req.SessionID),
			zap.String("call_id", req.CallID),
			zap.Error(err),
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to deliver result"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
