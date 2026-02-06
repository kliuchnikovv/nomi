package server

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	ginzap "github.com/gin-contrib/zap"
	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/container"
	"github.com/kliuchnikovv/genie-api/internal/handlers"
	"github.com/kliuchnikovv/genie-api/internal/llm"
	"github.com/kliuchnikovv/genie-api/internal/telegram"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
)

type Server struct {
	httpServer *http.Server
}

func New(
	logger *zap.Logger,
	cfg *config.Config,
	ctr *container.Container,
	oauthConfigs map[string]*oauth2.Config,
	oidcProviders map[string]*oidc.Provider,
	llmService *llm.Service,
) *Server {
	var r = gin.New()
	r.Use(
		ginzap.Ginzap(logger, time.RFC3339, true),
		ginzap.RecoveryWithZap(logger, true),
	)

	// Use Hub from Container
	hubInstance := ctr.Hub

	// Initialize handlers
	var (
		chatHandler        = handlers.NewChatHandler(ctr.ChatService)
		messageHandler     = handlers.NewMessageHandler(ctr.MessageService)
		authMiddleware     = auth.NewAuthMiddleware(ctr.TokenManager, ctr.Storage)
		authHandler        = handlers.NewAuthHandler(ctr.AuthService)
		streamHandler      = handlers.NewStreamHandler(logger, hubInstance, ctr.Storage, ctr.CredentialsStore)
		modelsHandler      = handlers.NewModelsHandler(os.Getenv("GOOGLE_API_KEY"))
		uploadHandler      = handlers.NewUploadHandler(ctr.Storage)
		credentialsHandler = handlers.NewCredentialsHandler(logger, ctr.CredentialsStore)

		mobileOAuthHandler = func() *handlers.MobileOAuthHandler {
			h, err := handlers.NewMobileOAuthHandler(logger, cfg, ctr.Storage)
			if err != nil {
				logger.Fatal("failed to initialize mobile oauth handler", zap.Error(err))
			}
			return h
		}()
		webhooksHandler     = handlers.NewWebhooksHandler(ctr.Storage, logger, cfg)
		toolsHandler        = handlers.NewToolsHandler(ctr.Storage, logger)
		integrationsHandler = handlers.NewIntegrationsHandler(ctr.Storage, logger)

		// Telegram integration (only initialized if bot token is configured)
		telegramHandler = func() *handlers.TelegramHandler {
			botToken := cfg.Telegram.BotToken
			if botToken == "" {
				botToken = os.Getenv("TELEGRAM_BOT_TOKEN")
			}
			if botToken == "" {
				logger.Info("TELEGRAM_BOT_TOKEN not set, telegram integration disabled")
				return nil
			}
			tgService := telegram.NewService(ctr.Storage.DB, hubInstance.Redis(), logger, botToken)
			tgDelivery := telegram.NewDeliveryService(tgService, hubInstance.Redis(), logger)
			// Load existing chat mappings from DB
			if err := tgDelivery.LoadTelegramChats(context.Background()); err != nil {
				logger.Warn("failed to load telegram chat mappings", zap.Error(err))
			}
			return handlers.NewTelegramHandler(tgService, tgDelivery, hubInstance, logger)
		}()
	)

	// existing handlers are standard http handlers; wrap them so they work
	r.GET("/", gin.WrapF(http.HandlerFunc(handlers.HelloWorld)))

	// Health check endpoint for Railway zero-downtime deployments
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
			"time":   time.Now().UTC().Format(time.RFC3339),
		})
	})

	// Auth API
	r.POST("/api/auth/register", wrap(http.HandlerFunc(authHandler.Register)))
	r.POST("/api/auth/login", wrap(http.HandlerFunc(authHandler.Login)))
	r.POST("/api/auth/refresh", wrap(http.HandlerFunc(authHandler.Refresh)))
	r.POST("/api/auth/google", wrap(http.HandlerFunc(authHandler.GoogleLogin)))
	r.GET("/api/auth/me", gin.WrapH(
		authMiddleware.RequireAuth(
			http.HandlerFunc(authHandler.GetMe),
		),
	))
	r.PUT("/api/auth/me", gin.WrapH(
		authMiddleware.RequireAuth(
			http.HandlerFunc(authHandler.UpdateMe),
		),
	))

	// Integrations API
	r.GET("/api/integrations", wrapWithAuth(integrationsHandler.ListIntegrations, authMiddleware))
	r.GET("/api/integrations/:id", wrapWithAuth(integrationsHandler.GetIntegration, authMiddleware))
	r.DELETE("/api/integrations/:id", wrapWithAuth(integrationsHandler.DeleteIntegration, authMiddleware))

	// Chat API (protected)
	r.POST("/api/chats", wrapWithAuth(chatHandler.CreateChat, authMiddleware))
	r.GET("/api/chats", wrapWithAuth(chatHandler.ListChats, authMiddleware))
	r.GET("/api/chats/:id", wrapWithAuth(chatHandler.GetChat, authMiddleware))
	r.PUT("/api/chats/:id", wrapWithAuth(chatHandler.UpdateChat, authMiddleware))
	r.DELETE("/api/chats/:id", wrapWithAuth(chatHandler.DeleteChat, authMiddleware))

	// Chat streaming API (WebSocket only)
	r.GET("/api/chat/ws", wrapWithAuth(streamHandler.ChatWS, authMiddleware))
	// Client tool result (round-trip proxy: device executes tool and sends result back)
	r.POST("/api/chat/client-tool-result", wrapWithAuth(streamHandler.ClientToolResult, authMiddleware))

	// Message API (protected)
	r.POST("/api/chats/:id/messages", wrapWithAuth(messageHandler.CreateMessage, authMiddleware))
	r.GET("/api/chats/:id/messages", wrapWithAuth(messageHandler.GetMessages, authMiddleware))

	// Models API.
	r.GET("/api/models", modelsHandler.ListModels)

	// Tools API (Used by Agent/Python Backend)
	// Takes ?session_id=... to resolve user context
	r.GET("/api/tools", toolsHandler.ListTools)

	// Plugins registry (manifest list for frontend/Python)
	r.GET("/api/plugins", handlers.ListPlugins)

	// File Upload API
	r.POST("/api/upload", wrapWithAuth(uploadHandler.UploadFile, authMiddleware))
	r.GET("/api/attachments/:id", wrapWithAuth(uploadHandler.GetAttachment, authMiddleware))

	// Webhooks
	r.POST("/api/webhooks/github", webhooksHandler.HandleGitHubWebhook)
	if telegramHandler != nil {
		r.POST("/api/webhooks/telegram", telegramHandler.HandleWebhook)
		r.POST("/api/telegram/link-token", wrapWithAuth(telegramHandler.GenerateLinkToken, authMiddleware))
	}

	// Mobile OAuth API (tokens returned to client, not stored on backend)
	r.GET("/api/oauth/:provider/callback", mobileOAuthHandler.Callback) // Web callback from Google, redirects to app
	r.POST("/api/oauth/:provider/login", wrapWithAuth(mobileOAuthHandler.Login, authMiddleware))
	r.POST("/api/oauth/:provider/callback-mobile", wrapWithAuth(mobileOAuthHandler.CallbackMobile, authMiddleware))
	r.POST("/api/oauth/refresh", mobileOAuthHandler.RefreshToken) // No auth needed, uses refresh_token

	// Credentials API - for API keys and custom credentials (stored in Redis)
	r.POST("/api/credentials", wrapWithAuth(credentialsHandler.Save, authMiddleware))
	r.GET("/api/credentials", wrapWithAuth(credentialsHandler.List, authMiddleware))
	r.GET("/api/credentials/:provider/check", wrapWithAuth(credentialsHandler.Check, authMiddleware))
	r.DELETE("/api/credentials/:provider", wrapWithAuth(credentialsHandler.Delete, authMiddleware))
	r.POST("/api/credentials/request", wrapWithAuth(credentialsHandler.Request, authMiddleware))

	// Proxy for Embeddings - forwards to Python backend
	r.POST("/api/embeddings", handlers.ProxyEmbeddings(cfg, logger))

	// Proxy for GitHub Repos - forwards to Python backend
	r.POST("/api/github/repos", handlers.ProxyGitHub(cfg, logger))

	return &Server{
		httpServer: &http.Server{
			Addr:    fmt.Sprintf(":%d", cfg.Server.Port),
			Handler: r,
		},
	}
}

func (s *Server) ListenAndServe() error {
	return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}
