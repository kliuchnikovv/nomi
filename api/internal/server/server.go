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
	"github.com/kliuchnikovv/genie-api/internal/handlers"
	"github.com/kliuchnikovv/genie-api/internal/handlers/team"
	"github.com/kliuchnikovv/genie-api/internal/hub"
	"github.com/kliuchnikovv/genie-api/internal/llm"
	"github.com/kliuchnikovv/genie-api/internal/notifier"
	"github.com/kliuchnikovv/genie-api/internal/plugins"
	"github.com/kliuchnikovv/genie-api/internal/plugins/jules"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
)

type Server struct {
	httpServer    *http.Server
	pluginManager *plugins.Manager
}

func New(
	logger *zap.Logger,
	cfg *config.Config,
	db *storage.Storage,
	oauthConfigs map[string]*oauth2.Config,
	oidcProviders map[string]*oidc.Provider,
	llmService *llm.Service,
) *Server {
	var r = gin.New()
	r.Use(
		ginzap.Ginzap(logger, time.RFC3339, true),
		ginzap.RecoveryWithZap(logger, true),
	)

	// Initialize notifier first
	n := notifier.New()

	// Plugin system initialization (Moved to top so handlers can use manager)
	pluginState := map[string]plugins.PluginState{}
	for name, st := range cfg.Plugins {
		pluginState[name] = plugins.PluginState{Enabled: st.Enabled, State: st.State}
	}
	// Force enable 'jules' if not configured (it uses per-user auth, safe to be globally enabled)
	if _, ok := pluginState["jules"]; !ok {
		pluginState["jules"] = plugins.PluginState{Enabled: true}
	}
	runtime := plugins.NewRuntime(
		plugins.NewNotifierAdapter(n),
		plugins.NewStorageAdapter(db),
		logger,
		plugins.NewLLMAdapter(llmService),
		oauthConfigs,
	)
	manager := plugins.NewManager(runtime, pluginState)
	if err := manager.Register(plugins.NewGenericIMAPPlugin()); err != nil {
		logger.Error("failed to register imap plugin", zap.Error(err))
	}
	if err := manager.Register(plugins.NewGmailPlugin()); err != nil {
		logger.Error("failed to register gmail plugin", zap.Error(err))
	}
	if err := manager.Register(jules.NewJulesPlugin()); err != nil {
		logger.Error("failed to register jules plugin", zap.Error(err))
	}

	// Initialize Hub
	hubInstance := hub.NewHub(db, logger, cfg.LLM.BaseURL)
	go hubInstance.Run()

	// Инициализация обработчиков
	var (
		// oauthHandler   = handlers.NewOAuth(cfg, db)
		chatHandler         = handlers.NewChatHandler(db)
		messageHandler      = handlers.NewMessageHandler(db)
		sidebarHandler      = handlers.NewSidebarHandler(db, llmService)
		actionsHandler      = handlers.NewActionsHandler(db, logger, manager) // Delegates to plugins
		integrationsHandler = handlers.NewIntegrationsHandler(db)
		pluginChatsHandler  = handlers.NewPluginChatsHandler(db)
		inboxHandler        = handlers.NewInboxHandler(db, logger)
		tokenManager        = auth.NewTokenManager(cfg.Token.JWTSecret)
		authMiddleware      = auth.NewAuthMiddleware(tokenManager, db)
		authHandler         = handlers.NewAuthHandler(db, tokenManager)
		streamHandler       = handlers.NewStreamHandler(logger, hubInstance, db)
// toolsHandler   = handlers.NewToolsHandler(db, oauthConfigs, imapDaemon) // OLD: commented out
		modelsHandler = handlers.NewModelsHandler(os.Getenv("GOOGLE_API_KEY"))
		uploadHandler = handlers.NewUploadHandler(db)
		teamHandler   = team.NewHandler(db)
		oauthHandler  = func() *handlers.OAuthHandler {
			h, err := handlers.NewOAuthHandler(logger, cfg, db, oauthConfigs, oidcProviders)
			if err != nil {
				logger.Fatal("failed to initialize oauth handler", zap.Error(err))
			}
			return h
		}()
	)

	// Initialize Scheduler (Task Manager)
	// We start it here.
	scheduler := hub.NewScheduler(db, hubInstance, logger)
	go scheduler.Start()

	_ = n // notifier will be used when needed

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
	// r.POST("/api/auth/logout", wrapWithAuth(authHandler.Logout, authMiddleware))
	r.POST("/api/auth/refresh", wrap(http.HandlerFunc(authHandler.Refresh)))
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

	// Task API (protected)
	// Allow INTERNAL_API_KEY for system calls (like from Python backend)
	tasksHandler := handlers.Handler{Store: db, Logger: logger} // TODO: Refactor handlers to common struct

	taskAuth := func(c *gin.Context) {
		// Check for Internal Secret
		secret := os.Getenv("INTERNAL_API_KEY")
		if secret == "" {
			secret = "jules-secret-key" // Default for dev
		}
		if c.GetHeader("X-Internal-Secret") == secret {
			c.Next()
			return
		}
		// Fallback to standard user auth
		authGinMiddleware(authMiddleware)(c)
	}

	r.POST("/api/tasks", taskAuth, gin.WrapH(http.HandlerFunc(tasksHandler.CreateTask)))

	// Team State API
	// Allow INTERNAL_API_KEY for system calls
	r.POST("/api/team/state", taskAuth, teamHandler.SetState)
	r.GET("/api/team/state", taskAuth, teamHandler.GetState)

	// Sidebar API - grouped inbox by plugin/integration
	r.GET("/api/sidebar", wrapWithAuth(sidebarHandler.ListSidebar, authMiddleware))
	r.GET("/api/sidebar/:provider/chats", wrapWithAuth(sidebarHandler.ListChats, authMiddleware))
	r.GET("/api/sidebar/:provider/chats/:chat_id", wrapWithAuth(sidebarHandler.GetChat, authMiddleware))
	r.POST("/api/sidebar/:provider/chats/:chat_id/messages", wrapWithAuth(sidebarHandler.PostChatMessage, authMiddleware))
	// Actions API - Delegates to plugins
	r.POST("/api/sidebar/:provider/messages/:id/actions", wrapWithAuth(actionsHandler.ExecuteAction, authMiddleware))

	// Inbox (chat -> thread -> message) API
	r.GET("/api/inbox", wrapWithAuth(inboxHandler.ListInbox, authMiddleware))

	// Plugin chats API
	r.GET("/api/plugin_chats", wrapWithAuth(pluginChatsHandler.ListPluginChats, authMiddleware))
	r.PATCH("/api/plugin_chats/:id", wrapWithAuth(pluginChatsHandler.UpdatePluginChat, authMiddleware))
	r.DELETE("/api/plugin_chats/:id", wrapWithAuth(pluginChatsHandler.DeletePluginChat, authMiddleware))

	// Integrations API
	r.GET("/api/integrations", wrapWithAuth(integrationsHandler.ListIntegrations, authMiddleware))
	r.PATCH("/api/integrations/:id", wrapWithAuth(integrationsHandler.UpdateIntegration, authMiddleware))
	r.DELETE("/api/integrations/:id", wrapWithAuth(integrationsHandler.DeleteIntegration, authMiddleware))

	// Models API.
	r.GET("/api/models", modelsHandler.ListModels)

	// File Upload API
	r.POST("/api/upload", wrapWithAuth(uploadHandler.UploadFile, authMiddleware))
	r.GET("/api/attachments/:id", wrapWithAuth(uploadHandler.GetAttachment, authMiddleware))

	// OAuth API
	r.POST("/api/oauth/:provider/login", wrapWithAuth(oauthHandler.Login, authMiddleware))
	r.GET("/api/oauth/:provider/redirect", oauthHandler.Redirect)
	r.GET("/api/oauth/:provider/callback", oauthHandler.Callback)

	pluginGroup := r.Group("/api/plugins")
	pluginGroup.Use(authGinMiddleware(authMiddleware))
	manager.Mount(pluginGroup)

	return &Server{
		httpServer: &http.Server{
			Addr:    fmt.Sprintf(":%d", cfg.Server.Port),
			Handler: r,
		},
		pluginManager: manager,
	}
}

func (s *Server) ListenAndServe() error {
	return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.pluginManager != nil {
		_ = s.pluginManager.Shutdown(ctx)
	}
	return s.httpServer.Shutdown(ctx)
}

func authGinMiddleware(authMiddleware *auth.AuthMiddleware) gin.HandlerFunc {
	return func(c *gin.Context) {
		wrapped := authMiddleware.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c.Request = r
		}))
		wrapped.ServeHTTP(c.Writer, c.Request)
		if c.Writer.Written() {
			c.Abort()
			return
		}
		c.Next()
	}
}
