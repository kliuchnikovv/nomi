package server

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	ginzap "github.com/gin-contrib/zap"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/daemon"
	"github.com/kliuchnikovv/genie-api/internal/handlers"
	"github.com/kliuchnikovv/genie-api/internal/llm"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
)

// GmailIMAPService interface for IMAP operations
type GmailIMAPService interface {
	MarkMessagesAsRead(ctx context.Context, userID uuid.UUID, uids []uint32) error
}

func New(
	logger *zap.Logger,
	cfg *config.Config,
	db *storage.Storage,
	imapDaemon *daemon.IMAPDaemon,
	oauthConfigs map[string]*oauth2.Config,
	oidcProviders map[string]*oidc.Provider,
	llmService *llm.Service,
	gmailIMAPService GmailIMAPService,
) *http.Server {
	var r = gin.New()
	r.Use(
		ginzap.Ginzap(logger, time.RFC3339, true),
		ginzap.RecoveryWithZap(logger, true),
	)

	// Инициализация обработчиков
	var (
		// oauthHandler   = handlers.NewOAuth(cfg, db)
		chatHandler    = handlers.NewChatHandler(db)
		messageHandler = handlers.NewMessageHandler(db)
		inboxHandler   = handlers.NewInboxHandler(db)
		actionsHandler = handlers.NewActionsHandler(db, llmService, logger, gmailIMAPService)
		tokenManager   = auth.NewTokenManager(cfg.Token.JWTSecret)
		authMiddleware = auth.NewAuthMiddleware(tokenManager, db)
		authHandler    = handlers.NewAuthHandler(db, tokenManager)
		streamHandler  = handlers.NewStreamHandler(logger, cfg.LLM.BaseURL, db)
		toolsHandler   = handlers.NewToolsHandler(db, oauthConfigs, imapDaemon)
		modelsHandler  = handlers.NewModelsHandler("configs/models.json")
		oauthHandler   = func() *handlers.OAuthHandler {
			h, err := handlers.NewOAuthHandler(logger, cfg, db, oauthConfigs, oidcProviders)
			if err != nil {
				logger.Fatal("failed to initialize oauth handler", zap.Error(err))
			}
			return h
		}()
	)

	// existing handlers are standard http handlers; wrap them so they work
	r.GET("/", gin.WrapF(http.HandlerFunc(handlers.HelloWorld)))

	// Auth API
	r.POST("/api/auth/register", wrap(http.HandlerFunc(authHandler.Register)))
	r.POST("/api/auth/login", wrap(http.HandlerFunc(authHandler.Login)))
	// r.POST("/api/auth/logout", wrapWithAuth(authHandler.Logout, authMiddleware))
	r.POST("/api/auth/refresh", wrap(http.HandlerFunc(authHandler.Refresh)))
	r.GET("/api/auth/me", gin.WrapH(
		authMiddleware.RequireAuth(
			http.HandlerFunc(authHandler.GetMe),
		),
	))

	// Chat API (protected)
	r.POST("/api/chats", wrapWithAuth(chatHandler.CreateChat, authMiddleware))
	r.GET("/api/chats", wrapWithAuth(chatHandler.ListChats, authMiddleware))
	r.GET("/api/chats/:id", wrapWithAuth(chatHandler.GetChat, authMiddleware))
	r.PUT("/api/chats/:id", wrapWithAuth(chatHandler.UpdateChat, authMiddleware))
	r.DELETE("/api/chats/:id", wrapWithAuth(chatHandler.DeleteChat, authMiddleware))

	// Chat streaming API (WebSocket only)
	r.GET("/api/chat/ws", wrapWithAuth(streamHandler.ChatWS, authMiddleware))

	// Message API (protected)
	r.POST("/api/chats/:id/messages", wrapWithAuth(messageHandler.CreateMessage, authMiddleware))
	r.GET("/api/chats/:id/messages", wrapWithAuth(messageHandler.GetMessages, authMiddleware))

	// Inbox API (protected)
	r.GET("/api/inbox", wrapWithAuth(inboxHandler.ListInboxMessages, authMiddleware))
	r.GET("/api/inbox/:id", wrapWithAuth(inboxHandler.GetInboxMessage, authMiddleware))
	r.PATCH("/api/inbox/:id/read", wrapWithAuth(inboxHandler.MarkAsRead, authMiddleware))
	r.POST("/api/inbox/:id/actions", wrapWithAuth(actionsHandler.ExecuteAction, authMiddleware))

	r.POST("/api/tools", wrapWithAuth(toolsHandler.CreateTool, authMiddleware))
	r.GET("/api/tools", wrapWithAuth(toolsHandler.ListTools, authMiddleware))
	r.GET("/api/tools/:id", wrapWithAuth(toolsHandler.GetTool, authMiddleware))
	r.PUT("/api/tools/:id", wrapWithAuth(toolsHandler.UpdateTool, authMiddleware))
	r.DELETE("/api/tools/:id", wrapWithAuth(toolsHandler.DeleteTool, authMiddleware))
	r.GET("/api/integrations", wrapWithAuth(toolsHandler.ListIntegrations, authMiddleware))
	r.POST("/api/integrations/gmail/sync", wrapWithAuth(toolsHandler.SyncGmail, authMiddleware))

	// Models API
	r.GET("/api/models", modelsHandler.ListModels)

	r.POST("/api/oauth/:provider/login", wrapWithAuth(oauthHandler.Login, authMiddleware))
	r.GET("/api/oauth/:provider/redirect", oauthHandler.Redirect)
	r.GET("/api/oauth/:provider/callback", oauthHandler.Callback)
	r.GET("/api/oauth/:provider", wrapWithAuth(toolsHandler.GetOAuthStatus, authMiddleware))

	// Serve Swagger UI (requires generated docs by swag). If generated
	// docs package is not present, fall back to the local static files
	// produced by `swag init` (docs/swagger.json + docs/swagger.html).
	// Place gin-swagger under /docs/swagger/* to avoid route conflicts with
	// static files served at /docs and /docs/swagger.json.
	r.GET("/docs/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))
	r.GET("/docs", func(c *gin.Context) {
		c.File("docs/swagger.html")
	})
	r.StaticFile("/docs/swagger.json", "docs/swagger.json")

	return &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.Server.Port),
		Handler: r,
	}
}
