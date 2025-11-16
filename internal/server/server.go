package server

import (
	"fmt"
	"net/http"
	"time"

	ginzap "github.com/gin-contrib/zap"
	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/handlers"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
	"go.uber.org/zap"
)

func New(
	logger *zap.Logger,
	cfg *config.Config,
	db *storage.Storage,
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
		tokenManager   = auth.NewTokenManager(cfg.Token.JWTSecret)
		authMiddleware = auth.NewAuthMiddleware(tokenManager, db)
		authHandler    = handlers.NewAuthHandler(db, tokenManager)
		streamHandler  = handlers.NewStreamHandler(logger, cfg.LLM.BaseURL, db)
		toolsHandler   = handlers.NewToolsHandler(db)
		oauthHandler   = func() *handlers.OAuthHandler {
			h, err := handlers.NewOAuthHandler(logger, cfg, db)
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
	r.GET("/chat/ws", wrapWithAuth(streamHandler.ChatWS, authMiddleware))

	// Message API (protected)
	r.POST("/api/chats/:id/messages", wrapWithAuth(messageHandler.CreateMessage, authMiddleware))
	r.GET("/api/chats/:id/messages", wrapWithAuth(messageHandler.GetMessages, authMiddleware))

	// r.POST("/api/tool-configs", wrapWithAuth(toolsHandler.CreateToolConfig, authMiddleware))
	r.GET("/api/tool-configs", wrapWithAuth(toolsHandler.ListToolConfigs, authMiddleware))
	r.GET("/api/tool-configs/:id", wrapWithAuth(toolsHandler.GetToolConfig, authMiddleware))
	// r.PUT("/api/tool-configs/:id", wrapWithAuth(toolsHandler.UpdateToolConfig, authMiddleware))
	// r.DELETE("/api/tool-configs/:id", wrapWithAuth(toolsHandler.DeleteToolConfig, authMiddleware))

	r.POST("/api/tools", wrapWithAuth(toolsHandler.CreateTool, authMiddleware))
	r.GET("/api/tools", wrapWithAuth(toolsHandler.ListTools, authMiddleware))
	r.GET("/api/tools/:id", wrapWithAuth(toolsHandler.GetTool, authMiddleware))
	r.PUT("/api/tools/:id", wrapWithAuth(toolsHandler.UpdateTool, authMiddleware))
	r.DELETE("/api/tools/:id", wrapWithAuth(toolsHandler.DeleteTool, authMiddleware))

	r.POST("/api/oauth/:provider/login", wrapWithAuth(oauthHandler.Login, authMiddleware))
	r.GET("/api/oauth/:provider/callback", oauthHandler.Callback)

	// TODO: OAUTH is diabled now

	// oauth flows (public endpoints)
	// r.POST("/oauth/:provider/login", wrap(http.HandlerFunc(oauthHandler.Redirect)))
	// r.GET("/oauth/:provider/callback", wrap(http.HandlerFunc(oauthHandler.Callback)))

	// Token management API (protected)
	// r.GET("/api/token/:profile/:provider", wrapWithAuthHttp(oauthHandler.GetToken, authMiddleware))
	// r.PUT("/api/token/:profile/:provider", wrapWithAuthHttp(oauthHandler.UpdateToken, authMiddleware))
	// r.DELETE("/api/token/:profile/:provider", wrapWithAuthHttp(oauthHandler.Disconnect, authMiddleware))
	// r.POST("/api/logs", wrapWithAuthHttp(oauthHandler.LogUsage, authMiddleware))
	// r.PUT("/api/permissions/:profile/:provider", wrapWithAuthHttp(oauthHandler.UpdatePermissions, authMiddleware))

	//
	// Additional Google-specific endpoints required by Swagger (protected)
	// r.GET("/api/status/:profile/google", wrapWithAuthHttp(oauthHandler.StatusGoogle, authMiddleware))
	// r.GET("/api/permissions/:profile/google", wrapWithAuthHttp(oauthHandler.GetPermissionsGoogle, authMiddleware))
	// r.GET("/api/logs", wrapWithAuthHttp(oauthHandler.ListLogs, authMiddleware))
	// r.POST("/api/disconnect/:profile/google", wrapWithAuthHttp(oauthHandler.DisconnectGooglePost, authMiddleware))
	// r.POST("/api/oauth/google/login", wrapWithAuthHttp(oauthHandler.OAuthGoogleLogin, authMiddleware))
	// r.POST("/api/oauth/google/reauthorize", wrapWithAuthHttp(oauthHandler.OAuthGoogleReauthorize, authMiddleware))

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
