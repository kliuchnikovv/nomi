package server

import (
	"context"
	"encoding/hex"
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
	"github.com/kliuchnikovv/genie-api/internal/proactive"
	"github.com/kliuchnikovv/genie-api/internal/watch"
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
		projectHandler     = handlers.NewProjectHandler(ctr.ProjectService)
		projectDocHandler  = handlers.NewProjectDocumentHandler(ctr.Storage, cfg, logger)
		messageHandler     = handlers.NewMessageHandler(ctr.MessageService)
		authMiddleware     = auth.NewAuthMiddleware(ctr.TokenManager, ctr.Storage)
		authHandler        = handlers.NewAuthHandler(ctr.AuthService)
		streamHandler      = handlers.NewStreamHandler(logger, hubInstance, ctr.Storage, ctr.CredentialsStore)
		modelsHandler      = handlers.NewModelsHandler(os.Getenv("GOOGLE_API_KEY"))
		uploadHandler      = handlers.NewUploadHandler(ctr.Storage)
		credentialsHandler = handlers.NewCredentialsHandler(logger, ctr.CredentialsStore)
		cryptoKey          []byte
	)

	// Parse encryption key once
	var err error
	cryptoKey, err = hex.DecodeString(cfg.Token.EncryptionKey)
	if err != nil || len(cryptoKey) != 32 {
		logger.Fatal("invalid encryption_key in config: must be 64 hex chars (32 bytes)", zap.Error(err))
	}

	var (
		mobileOAuthHandler = func() *handlers.MobileOAuthHandler {
			h, err := handlers.NewMobileOAuthHandler(logger, cfg, ctr.Storage, cryptoKey)
			if err != nil {
				logger.Fatal("failed to initialize mobile oauth handler", zap.Error(err))
			}
			return h
		}()
		byokHandler           = handlers.NewBYOKHandler(logger, ctr.Storage, cryptoKey)
		toolsHandler          = handlers.NewToolsHandler(ctr.Storage, logger, cryptoKey, ctr.GitHubApp)
		integrationsHandler   = handlers.NewIntegrationsHandler(ctr.Storage, logger, ctr.GitHubApp)
		githubAppHandler      = handlers.NewGitHubAppHandler(logger, cfg, ctr.Storage)
		webhooksHandler       = handlers.NewWebhooksHandler(ctr.Storage, logger, cfg)
		botIdentityHandler    = handlers.NewBotIdentityHandler(ctr.Storage, logger)
		planDocumentsHandler  = handlers.NewPlanDocumentsHandler(ctr.Storage, logger)
		memoriesHandler       = handlers.NewMemoriesHandler(ctr.Storage, logger)
		entitiesHandler       = handlers.NewEntitiesHandler(ctr.Storage, logger)
		notificationsHandler  = handlers.NewNotificationsHandler(ctr.Storage)
		agentTasksHandler     = handlers.NewAgentTasksHandler(ctr.Storage, hubInstance.Redis())
		devicesHandler        = handlers.NewDevicesHandler(ctr.Storage)
		heartbeatHandler      = handlers.NewHeartbeatHandler(ctr.Storage, logger)
		workerHandler         = handlers.NewWorkerHandler(hubInstance, logger)

		proactiveDispatcher = proactive.NewDispatcher(ctr.Storage, hubInstance.Redis(), logger)
		proactiveHandler    = proactive.NewHandler(ctr.Storage, proactiveDispatcher)
		watchHandler        = watch.NewHandler(ctr.Storage)
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

	// Chat API (protected)
	r.POST("/api/chats", wrapWithAuth(chatHandler.CreateChat, authMiddleware))
	r.GET("/api/chats", wrapWithAuth(chatHandler.ListChats, authMiddleware))
	r.GET("/api/chats/persistent", wrapWithAuth(chatHandler.GetPersistentChat, authMiddleware))
	r.GET("/api/chats/persistent/all", wrapWithAuth(chatHandler.ListPersistentChats, authMiddleware))
	r.GET("/api/chats/:id", wrapWithAuth(chatHandler.GetChat, authMiddleware))
	r.PUT("/api/chats/:id", wrapWithAuth(chatHandler.UpdateChat, authMiddleware))
	r.DELETE("/api/chats/:id", wrapWithAuth(chatHandler.DeleteChat, authMiddleware))
	r.POST("/api/chats/:id/archive-messages", wrapWithAuth(chatHandler.ArchiveMessages, authMiddleware))

	// Projects API (protected)
	r.GET("/api/projects", wrapWithAuth(projectHandler.ListProjects, authMiddleware))
	r.POST("/api/projects", wrapWithAuth(projectHandler.CreateProject, authMiddleware))
	r.PUT("/api/projects/:id", wrapWithAuth(projectHandler.UpdateProject, authMiddleware))
	r.DELETE("/api/projects/:id", wrapWithAuth(projectHandler.DeleteProject, authMiddleware))
	// Project documents (files attached to a project; parsed + embedded by the brain)
	r.POST("/api/projects/:id/documents", wrapWithAuth(projectDocHandler.UploadProjectDocument, authMiddleware))
	r.GET("/api/projects/:id/documents", wrapWithAuth(projectDocHandler.ListProjectDocuments, authMiddleware))
	r.DELETE("/api/projects/:id/documents/:docId", wrapWithAuth(projectDocHandler.DeleteProjectDocument, authMiddleware))

	// Chat streaming API (WebSocket only)
	r.GET("/api/chat/ws", wrapWithAuth(streamHandler.ChatWS, authMiddleware))
	// Internal: Python workers connect here to deliver response frames directly (bypasses Redis)
	r.GET("/internal/worker", workerHandler.WorkerWS)
	// Client tool result (round-trip proxy: device executes tool and sends result back)
	r.POST("/api/chat/client-tool-result", wrapWithAuth(streamHandler.ClientToolResult, authMiddleware))

	// Pending client actions (offline outbox).
	// Internal (Python brain): enqueue + wake device; finalize when result arrived in time.
	r.POST("/internal/pending-actions/enqueue", streamHandler.EnqueuePendingAction)
	r.POST("/internal/pending-actions/finalize", streamHandler.FinalizePendingAction)
	// Device-facing (authenticated): drain queue + report results.
	r.GET("/api/pending-actions", wrapWithAuth(streamHandler.ListPendingActions, authMiddleware))
	r.POST("/api/pending-actions/result", wrapWithAuth(streamHandler.PendingActionResult, authMiddleware))

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

	// Bot Identity API — MUST be before the wildcard /api/:plugin/*path route
	r.GET("/api/user/bot-identity", wrapWithAuth(botIdentityHandler.GetBotIdentity, authMiddleware))
	r.PUT("/api/user/bot-identity", wrapWithAuth(botIdentityHandler.UpsertBotIdentity, authMiddleware))

	// Memories API — MUST be before the wildcard /api/:plugin/*path route
	r.GET("/api/user/memories", wrapWithAuth(memoriesHandler.GetMemories, authMiddleware))
	r.DELETE("/api/user/memories/:id", wrapWithAuth(memoriesHandler.DeleteMemory, authMiddleware))

	// Entities API — MUST be before the wildcard /api/:plugin/*path route
	r.GET("/api/user/entities", wrapWithAuth(entitiesHandler.GetEntities, authMiddleware))

	// RAG index — forward personal data indexing requests to Python backend
	// IMPORTANT: Must be registered before the wildcard /api/:plugin/*path route
	r.POST("/api/rag/index", wrapWithAuth(handlers.ProxyRagIndex(cfg, logger), authMiddleware))

	// Voice TTS — forward server-side Gemini speech synthesis to Python backend
	// IMPORTANT: Must be registered before the wildcard /api/:plugin/*path route
	r.POST("/api/voice/tts", wrapWithAuth(handlers.ProxyVoiceTTS(cfg, logger), authMiddleware))

	// Email analysis — forward email importance analysis requests to Python backend (gpt-5-nano)
	// IMPORTANT: Must be registered before the wildcard /api/:plugin/*path route
	r.POST("/api/emails/analyze", wrapWithAuth(handlers.ProxyEmailAnalyze(cfg, logger), authMiddleware))

	// Planning session state — forward to Python backend
	// IMPORTANT: Must be registered before the wildcard /api/:plugin/*path route
	r.GET("/api/planning/session/:chat_id", wrapWithAuth(handlers.ProxyPlanningSession(cfg, logger), authMiddleware))

	// Plan Documents API
	// IMPORTANT: Must be registered before the wildcard /api/:plugin/*path route
	r.GET("/api/plan-documents", wrapWithAuth(planDocumentsHandler.GetPlanDocument, authMiddleware))
	r.POST("/api/plan-documents", wrapWithAuth(planDocumentsHandler.CreatePlanDocument, authMiddleware))
	r.PATCH("/api/plan-documents/:id", wrapWithAuth(planDocumentsHandler.PatchPlanDocument, authMiddleware))

	// Notifications API
	// IMPORTANT: Must be registered before the wildcard /api/:plugin/*path route
	r.POST("/api/notifications", wrapWithAuth(notificationsHandler.Create, authMiddleware))
	r.GET("/api/notifications", wrapWithAuth(notificationsHandler.List, authMiddleware))
	r.DELETE("/api/notifications/:id", wrapWithAuth(notificationsHandler.Cancel, authMiddleware))

	// Agent tasks API (long-running autonomous tasks)
	// IMPORTANT: Must be registered before the wildcard /api/:plugin/*path route
	r.POST("/api/tasks", wrapWithAuth(agentTasksHandler.Create, authMiddleware))
	r.GET("/api/tasks", wrapWithAuth(agentTasksHandler.List, authMiddleware))
	r.GET("/api/tasks/:id", wrapWithAuth(agentTasksHandler.Get, authMiddleware))
	r.POST("/api/tasks/:id/steer", wrapWithAuth(agentTasksHandler.Steer, authMiddleware))
	r.POST("/api/tasks/:id/approve", wrapWithAuth(agentTasksHandler.Approve, authMiddleware))
	r.POST("/api/tasks/:id/stop", wrapWithAuth(agentTasksHandler.Stop, authMiddleware))

	// Device token registration
	// IMPORTANT: Must be registered before the wildcard /api/:plugin/*path route
	r.POST("/api/devices", wrapWithAuth(devicesHandler.Register, authMiddleware))
	r.DELETE("/api/devices/:token", wrapWithAuth(devicesHandler.Deregister, authMiddleware))

	// Diagnostic heartbeat — used to confirm mobile background tasks actually run
	r.POST("/api/heartbeat", wrapWithAuth(heartbeatHandler.Record, authMiddleware))
	r.GET("/api/heartbeat", wrapWithAuth(heartbeatHandler.List, authMiddleware))

	// Proactive event ingest + state transitions (reactive-agent pipeline)
	// IMPORTANT: Must be registered before the wildcard /api/:plugin/*path route
	r.POST("/api/events/ingest", wrapWithAuth(proactiveHandler.IngestEvent, authMiddleware))
	r.POST("/api/events/:id/state", wrapWithAuth(proactiveHandler.SetEventState, authMiddleware))

	// Agent-set watch reminders ("remind me about Y at time T")
	// IMPORTANT: Must be registered before the wildcard /api/:plugin/*path route
	r.POST("/api/watches", wrapWithAuth(watchHandler.Create, authMiddleware))
	r.GET("/api/watches", wrapWithAuth(watchHandler.List, authMiddleware))
	r.DELETE("/api/watches/:id", wrapWithAuth(watchHandler.Cancel, authMiddleware))

	// Generic plugin proxy — forwards all requests to Python plugins
	// Routes: /api/{plugin}/*path -> /api/plugins/{plugin}/*path
	// Examples:
	//   /api/github/repos -> /api/plugins/github/repos
	//   /api/github/repos/owner/repo -> /api/plugins/github/repos/owner/repo
	//   /api/telegram/messages -> /api/plugins/telegram/messages
	// IMPORTANT: This route must be defined BEFORE /api/integrations/:id to avoid conflicts
	r.Any("/api/:plugin/*path", wrapWithAuth(handlers.ProxyPlugins(cfg, logger, ctr.Storage, cryptoKey, ctr.GitHubApp), authMiddleware))

	// Integrations API
	r.GET("/api/integrations", wrapWithAuth(integrationsHandler.ListIntegrations, authMiddleware))
	r.GET("/api/integrations/:id", wrapWithAuth(integrationsHandler.GetIntegration, authMiddleware))
	r.DELETE("/api/integrations/:id", wrapWithAuth(integrationsHandler.DeleteIntegration, authMiddleware))
	// IMAP credentials stored server-side so the brain can run email tools without the device.
	r.POST("/api/integrations/imap/credentials", wrapWithAuth(mobileOAuthHandler.StoreImapCredentials, authMiddleware))

	// GitHub App installation flow: authed endpoint returns the install URL; the
	// callback is public (user identified via signed state) and persists installation_id.
	r.GET("/api/integrations/github/app/install", wrapWithAuth(githubAppHandler.Install, authMiddleware))
	r.GET("/api/integrations/github/app/callback", githubAppHandler.Callback)
	// GitHub App webhook (public; authenticated by HMAC signature). Reacts to
	// `installation` events so removing the app on GitHub disconnects it here too.
	r.POST("/api/integrations/github/app/webhook", webhooksHandler.HandleGitHubWebhook)

	// File Upload API
	r.POST("/api/upload", wrapWithAuth(uploadHandler.UploadFile, authMiddleware))
	r.GET("/api/attachments/:id", wrapWithAuth(uploadHandler.GetAttachment, authMiddleware))

	// Webhooks — public routes for plugin webhooks (no auth)
	// Route: /api/webhooks/{plugin}/*path -> /api/plugins/{plugin}/webhook/*path
	r.Any("/api/webhooks/:plugin/*path", handlers.ProxyWebhooks(cfg, logger))

	// Mobile OAuth API (tokens returned to client, not stored on backend)
	r.GET("/api/oauth/:provider/callback", mobileOAuthHandler.Callback) // Web callback from Google, redirects to app
	r.POST("/api/oauth/:provider/login", wrapWithAuth(mobileOAuthHandler.Login, authMiddleware))
	r.POST("/api/oauth/:provider/callback-mobile", wrapWithAuth(mobileOAuthHandler.CallbackMobile, authMiddleware))
	r.POST("/api/oauth/refresh", mobileOAuthHandler.RefreshToken)                                              // No auth needed, uses refresh_token
	r.POST("/api/oauth/:provider/access-token", wrapWithAuth(mobileOAuthHandler.GetAccessToken, authMiddleware)) // Device: fresh access token from server-stored refresh token
	r.POST("/api/oauth/:provider/update-token", mobileOAuthHandler.UpdateStoredToken)                          // Internal: persist refreshed token from Python

	// Credentials API - for API keys and custom credentials (stored in Redis)
	r.POST("/api/credentials", wrapWithAuth(credentialsHandler.Save, authMiddleware))
	r.GET("/api/credentials", wrapWithAuth(credentialsHandler.List, authMiddleware))
	r.GET("/api/credentials/:provider/check", wrapWithAuth(credentialsHandler.Check, authMiddleware))
	r.DELETE("/api/credentials/:provider", wrapWithAuth(credentialsHandler.Delete, authMiddleware))
	r.POST("/api/credentials/request", wrapWithAuth(credentialsHandler.Request, authMiddleware))

	// BYOK API - user-supplied LLM provider API keys (encrypted at rest in Postgres)
	r.GET("/api/byok", wrapWithAuth(byokHandler.List, authMiddleware))
	r.PUT("/api/byok/:provider", wrapWithAuth(byokHandler.Save, authMiddleware))
	r.PUT("/api/byok/:provider/default", wrapWithAuth(byokHandler.SetDefault, authMiddleware))
	r.DELETE("/api/byok/:provider", wrapWithAuth(byokHandler.Delete, authMiddleware))

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
