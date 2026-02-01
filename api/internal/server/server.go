package server

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	ginzap "github.com/gin-contrib/zap"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/container"
	"github.com/kliuchnikovv/genie-api/internal/handlers"
	"github.com/kliuchnikovv/genie-api/internal/handlers/team"
	"github.com/kliuchnikovv/genie-api/internal/hub"
	"github.com/kliuchnikovv/genie-api/internal/llm"
	"github.com/kliuchnikovv/genie-api/internal/notifier"
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

	// Initialize notifier first
	n := notifier.New()

	// Используем Hub из Container
	hubInstance := ctr.Hub

	// Инициализация обработчиков
	var (
		chatHandler        = handlers.NewChatHandler(ctr.ChatService)
		messageHandler     = handlers.NewMessageHandler(ctr.MessageService)
		sidebarHandler     = handlers.NewSidebarHandler(ctr.Storage, llmService)
		pluginChatsHandler = handlers.NewPluginChatsHandler(ctr.Storage)
		inboxHandler       = handlers.NewInboxHandler(ctr.Storage, logger)
		authMiddleware     = auth.NewAuthMiddleware(ctr.TokenManager, ctr.Storage)
		authHandler        = handlers.NewAuthHandler(ctr.AuthService)
		streamHandler      = handlers.NewStreamHandler(logger, hubInstance, ctr.Storage)
		modelsHandler      = handlers.NewModelsHandler(os.Getenv("GOOGLE_API_KEY"))
		uploadHandler      = handlers.NewUploadHandler(ctr.Storage)
		teamHandler        = team.NewHandler(ctr.Storage)

		mobileOAuthHandler = func() *handlers.MobileOAuthHandler {
			h, err := handlers.NewMobileOAuthHandler(logger, cfg, ctr.Storage)
			if err != nil {
				logger.Fatal("failed to initialize mobile oauth handler", zap.Error(err))
			}
			return h
		}()
		briefingHandler      = handlers.NewBriefingHandler(ctr.Storage, llmService)
		emailAnalysisHandler = handlers.NewEmailAnalysisHandler(ctr.Storage, llmService)
		dashboardHandler     = handlers.NewDashboardHandler(ctr.Storage)
		julesHandler         = handlers.NewJulesAuthHandler(ctr.Storage, logger)
		projectTaskHandler   = handlers.NewProjectTaskHandler(ctr.Storage, logger, cfg, hubInstance)
		projectHandler       = handlers.NewProjectHandler(ctr.Storage, logger, cfg, hubInstance)
		listHandler          = handlers.NewListHandler(ctr.Storage, logger, cfg)
		webhooksHandler      = handlers.NewWebhooksHandler(ctr.Storage, logger, cfg)
		toolsHandler         = handlers.NewToolsHandler(ctr.Storage, logger)
		integrationsHandler  = handlers.NewIntegrationsHandler(ctr.Storage, logger)
	)

	// Initialize Scheduler (Task Manager)
	scheduler := hub.NewScheduler(ctr.Storage, hubInstance, logger)
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

	// Jules Integration
	r.POST("/api/jules/connect", wrapWithAuth(julesHandler.Connect, authMiddleware))

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
	tasksHandler := handlers.Handler{Store: ctr.Storage, Logger: logger} // TODO: Refactor handlers to common struct

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

	// Projects API
	r.POST("/api/projects", wrapWithAuth(projectHandler.CreateProject, authMiddleware))
	r.GET("/api/projects", wrapWithAuth(projectHandler.ListProjects, authMiddleware))
	r.GET("/api/projects/:id", wrapWithAuth(projectHandler.GetProject, authMiddleware))
	r.PUT("/api/projects/:id", wrapWithAuth(projectHandler.UpdateProject, authMiddleware))
	r.DELETE("/api/projects/:id", wrapWithAuth(projectHandler.DeleteProject, authMiddleware))
	r.PATCH("/api/projects/:id/status", taskAuth, projectHandler.UpdateStatus)
	r.POST("/api/projects/:id/reindex", wrapWithAuth(projectHandler.ReindexProject, authMiddleware))

	// Lists API (user lists with per-list RAG)
	r.POST("/api/lists", wrapWithAuth(listHandler.CreateList, authMiddleware))
	r.GET("/api/lists", wrapWithAuth(listHandler.ListLists, authMiddleware))
	r.GET("/api/lists/:id", wrapWithAuth(listHandler.GetList, authMiddleware))
	r.PUT("/api/lists/:id", wrapWithAuth(listHandler.UpdateList, authMiddleware))
	r.DELETE("/api/lists/:id", wrapWithAuth(listHandler.DeleteList, authMiddleware))
	r.POST("/api/lists/:id/items", wrapWithAuth(listHandler.CreateListItem, authMiddleware))
	r.GET("/api/lists/:id/items", wrapWithAuth(listHandler.ListListItems, authMiddleware))
	r.GET("/api/lists/:id/items/:itemId", wrapWithAuth(listHandler.GetListItem, authMiddleware))
	r.PUT("/api/lists/:id/items/:itemId", wrapWithAuth(listHandler.UpdateListItem, authMiddleware))
	r.DELETE("/api/lists/:id/items/:itemId", wrapWithAuth(listHandler.DeleteListItem, authMiddleware))

	// Project Tasks API (CRUD)
	// Allow internal API key for task creation (Architect agent)
	r.POST("/api/projects/:id/tasks", func(c *gin.Context) {
		secret := os.Getenv("INTERNAL_API_KEY")
		if secret == "" {
			secret = "jules-secret-key"
		}
		if c.GetHeader("X-Internal-Secret") == secret {
			// For internal calls, we need to manually set the userID in context if the handler relies on it.
			// However, the handler extracts userID from context `userID := c.MustGet("userID").(uuid.UUID)`
			// We need to pass the userID in the header or body for internal calls, or have the handler support it.
			// Let's modify the handler or provide a middleware that extracts User-ID header for internal calls.
			userIDStr := c.GetHeader("X-User-ID")
			if userIDStr != "" {
				if uid, err := uuid.Parse(userIDStr); err == nil {
					c.Set("userID", uid)
					gin.WrapH(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						// Wrap to match signature if needed, but projectHandler.CreateTask is a gin.HandlerFunc
						projectHandler.CreateTask(c)
					}))(c)
					return
				}
			}
			// If no User-ID provided for internal call, it might fail in handler.
			// Let's assume the caller provides X-User-ID.
			c.JSON(http.StatusBadRequest, gin.H{"error": "X-User-ID header required for internal calls"})
			return
		}
		// Fallback to standard user auth
		wrapWithAuth(projectHandler.CreateTask, authMiddleware)(c)
	})
	r.GET("/api/projects/:id/tasks", wrapWithAuth(projectHandler.ListTasks, authMiddleware))
	r.GET("/api/project-tasks/:id", wrapWithAuth(projectHandler.GetTask, authMiddleware))
	r.PUT("/api/project-tasks/:id", wrapWithAuth(projectHandler.UpdateTask, authMiddleware))
	r.DELETE("/api/project-tasks/:id", wrapWithAuth(projectHandler.DeleteTask, authMiddleware))
	r.POST("/api/project-tasks/:id/subtasks", taskAuth, projectHandler.CreateSubtask)
	// State Machine Transition
	r.PATCH("/api/project-tasks/:id/status", taskAuth, projectTaskHandler.UpdateStatus)
	r.GET("/api/active-tasks", wrapWithAuth(projectTaskHandler.GetActiveTasks, authMiddleware))

	// Team State API
	r.POST("/api/team/state", taskAuth, teamHandler.SetState)
	r.GET("/api/team/state", taskAuth, teamHandler.GetState)

	// Sidebar API - grouped inbox by plugin/integration
	r.GET("/api/sidebar", wrapWithAuth(sidebarHandler.ListSidebar, authMiddleware))
	r.GET("/api/sidebar/:provider/chats", wrapWithAuth(sidebarHandler.ListChats, authMiddleware))
	r.GET("/api/sidebar/:provider/chats/:chat_id", wrapWithAuth(sidebarHandler.GetChat, authMiddleware))
	r.POST("/api/sidebar/:provider/chats/:chat_id/messages", wrapWithAuth(sidebarHandler.PostChatMessage, authMiddleware))

	// Inbox (chat -> thread -> message) API
	r.GET("/api/inbox", wrapWithAuth(inboxHandler.ListInbox, authMiddleware))

	// Plugin chats API
	r.GET("/api/plugin_chats", wrapWithAuth(pluginChatsHandler.ListPluginChats, authMiddleware))
	r.PATCH("/api/plugin_chats/:id", wrapWithAuth(pluginChatsHandler.UpdatePluginChat, authMiddleware))
	r.DELETE("/api/plugin_chats/:id", wrapWithAuth(pluginChatsHandler.DeletePluginChat, authMiddleware))

	// Models API.
	r.GET("/api/models", modelsHandler.ListModels)

	// Tools API (Used by Agent/Python Backend)
	// Takes ?session_id=... to resolve user context
	r.GET("/api/tools", toolsHandler.ListTools)

	// File Upload API
	r.POST("/api/upload", wrapWithAuth(uploadHandler.UploadFile, authMiddleware))
	r.GET("/api/attachments/:id", wrapWithAuth(uploadHandler.GetAttachment, authMiddleware))

	// Webhooks
	r.POST("/api/webhooks/github", webhooksHandler.HandleGitHubWebhook)
	r.POST("/api/webhooks/jules", webhooksHandler.HandleJulesWebhook)

	// Mobile OAuth API (tokens returned to client, not stored on backend)
	r.GET("/api/oauth/:provider/callback", mobileOAuthHandler.Callback) // Web callback from Google, redirects to app
	r.POST("/api/oauth/:provider/login", wrapWithAuth(mobileOAuthHandler.Login, authMiddleware))
	r.POST("/api/oauth/:provider/callback-mobile", wrapWithAuth(mobileOAuthHandler.CallbackMobile, authMiddleware))
	r.POST("/api/oauth/refresh", mobileOAuthHandler.RefreshToken) // No auth needed, uses refresh_token

	r.POST("/api/briefing", wrapWithAuth(briefingHandler.GetBriefing, authMiddleware))
	r.POST("/api/analyze-email", emailAnalysisHandler.AnalyzeEmail) // No auth - frontend calls with email data
	r.GET("/api/dashboard", wrapWithAuth(dashboardHandler.GetDashboard, authMiddleware))

	// Proxy for Embeddings (transient) - forwards to Python backend
	r.POST("/api/embeddings", func(c *gin.Context) {
		// Use LLM BaseURL from config, or default to internal Python service URL
		// Using 'http://127.0.0.1:7777' as default since app.py listens on 7777
		targetURL := cfg.LLM.BaseURL
		if targetURL == "" {
			targetURL = "http://127.0.0.1:7777"
		}

		// Create proxy request
		proxyReq, err := http.NewRequest(c.Request.Method, targetURL+"/api/embeddings", c.Request.Body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create proxy request"})
			return
		}

		// Copy headers
		for name, values := range c.Request.Header {
			for _, value := range values {
				proxyReq.Header.Add(name, value)
			}
		}

		// Send request
		client := &http.Client{Timeout: 60 * time.Second} // Higher timeout for batch requests
		resp, err := client.Do(proxyReq)
		if err != nil {
			logger.Error("Failed to proxy embeddings request", zap.Error(err))
			c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to contact AI service"})
			return
		}
		defer resp.Body.Close()

		// Copy response headers
		for name, values := range resp.Header {
			for _, value := range values {
				c.Writer.Header().Add(name, value)
			}
		}
		c.Status(resp.StatusCode)

		// Stream response body
		_, _ = io.Copy(c.Writer, resp.Body)
	})

	// Proxy for GitHub Repos (transient) - forwards to Python backend
	r.POST("/api/github/repos", func(c *gin.Context) {
		// Use LLM BaseURL from config, or default to internal Python service URL
		// Using 'http://127.0.0.1:7777' as default since app.py listens on 7777
		targetURL := cfg.LLM.BaseURL
		if targetURL == "" {
			targetURL = "http://127.0.0.1:7777"
		}

		// Create proxy request
		proxyReq, err := http.NewRequest(c.Request.Method, targetURL+"/api/github/repos", c.Request.Body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create proxy request"})
			return
		}

		// Copy headers
		for name, values := range c.Request.Header {
			for _, value := range values {
				proxyReq.Header.Add(name, value)
			}
		}

		// Send request
		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(proxyReq)
		if err != nil {
			logger.Error("Failed to proxy github repos request", zap.Error(err))
			c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to contact AI service"})
			return
		}
		defer resp.Body.Close()

		// Copy response headers
		for name, values := range resp.Header {
			for _, value := range values {
				c.Writer.Header().Add(name, value)
			}
		}
		c.Status(resp.StatusCode)

		// Stream response body
		_, _ = io.Copy(c.Writer, resp.Body)
	})

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
