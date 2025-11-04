package server

import (
    "fmt"
    "net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/handlers"
	"github.com/kliuchnikovv/genie-api/internal/notifier"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

// wrap converts a standard http.HandlerFunc into a gin.HandlerFunc and
// populates mux URL vars from gin path params so existing handlers that
// rely on mux.Vars() continue to work.
func wrap(h http.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		vars := map[string]string{}
		for _, p := range c.Params {
			vars[p.Key] = p.Value
		}
		req := mux.SetURLVars(c.Request, vars)
		h(c.Writer, req)
	}
}

// wrapWithAuth оборачивает gin.HandlerFunc в middleware авторизации
func wrapWithAuth(h gin.HandlerFunc, authMiddleware *auth.AuthMiddleware) gin.HandlerFunc {
	return func(c *gin.Context) {
		wrapped := gin.WrapH(authMiddleware.RequireAuth(
			http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Восстанавливаем gin.Context из http.Request
				c.Request = r
				h(c)
			}),
		))
		wrapped(c)
	}
}

// wrapWithAuthHttp оборачивает http.HandlerFunc в middleware авторизации
func wrapWithAuthHttp(h http.HandlerFunc, authMiddleware *auth.AuthMiddleware) gin.HandlerFunc {
	return gin.WrapH(authMiddleware.RequireAuth(h))
}

// chatEventsAdapter adapts notifier.Notifier to the interface expected by
// handlers.MessageHandler.Events via gin context.
type chatEventsAdapter struct {
	c *gin.Context
	n *notifier.Notifier
}

type mapEvent = map[string]interface{}

func (a chatEventsAdapter) Subscribe(chatID uuid.UUID) chan mapEvent {
	src := a.n.Subscribe(chatID)
	out := make(chan mapEvent, 8)
	go func() {
		for ev := range src {
			if m, ok := ev.Payload.(map[string]interface{}); ok {
				out <- m
			}
		}
		close(out)
	}()
	a.c.Set("_rawChatSub", src)
	return out
}

func (a chatEventsAdapter) Unsubscribe(chatID uuid.UUID, ch chan mapEvent) {
	if v, exists := a.c.Get("_rawChatSub"); exists {
		if raw, ok := v.(chan notifier.Event); ok {
			a.n.Unsubscribe(chatID, raw)
		}
	}
	close(ch)
}

func New(cfg *config.Config, db *storage.Storage) *http.Server {
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	// Инициализация обработчиков
	tokenManager := auth.NewTokenManager(cfg.Token.JWTSecret)
	authMiddleware := auth.NewAuthMiddleware(tokenManager, db)
	authHandler := handlers.NewAuthHandler(db, tokenManager)
	oauthHandler := handlers.NewOAuth(cfg, db)
    streamHandler := handlers.NewStreamHandler(cfg.LLM.BaseURL, db)
	chatHandler := handlers.NewChatHandler(db)
	// Shared notifier for SSE
	n := notifier.New()
	messageHandler := handlers.NewMessageHandler(db).WithNotifier(func(chatID uuid.UUID, ev interface{}) {
		// publish as-is; clients interpret payload
		n.Publish(chatID, notifier.Event{Type: "message", Payload: ev})
	})
    // gRPC processor removed; using WS proxy to Python

	// Auth API
	r.POST("/api/auth/register", wrap(http.HandlerFunc(authHandler.Register)))
	r.POST("/api/auth/login", wrap(http.HandlerFunc(authHandler.Login)))
	r.POST("/api/auth/refresh", wrap(http.HandlerFunc(authHandler.Refresh)))
	r.GET("/api/auth/me", gin.WrapH(
		authMiddleware.RequireAuth(
			http.HandlerFunc(authHandler.GetMe),
		),
	))

	// existing handlers are standard http handlers; wrap them so they work
	r.GET("/", gin.WrapF(http.HandlerFunc(handlers.HelloWorld)))

	// Chat API (protected)
	// r.POST("/api/chats", wrapWithAuth(chatHandler.CreateChat, authMiddleware))
	r.GET("/api/chats", wrapWithAuth(chatHandler.ListChats, authMiddleware))
	r.GET("/api/chats/:id", wrapWithAuth(chatHandler.GetChat, authMiddleware))
	r.PUT("/api/chats/:id", wrapWithAuth(chatHandler.UpdateChat, authMiddleware))
	r.DELETE("/api/chats/:id", wrapWithAuth(chatHandler.DeleteChat, authMiddleware))

    // Chat streaming API (WebSocket only)
    r.GET("/chat/ws", wrapWithAuth(streamHandler.ChatWS, authMiddleware))

	// Message API (protected)
	r.POST("/api/chats/:id/messages", wrapWithAuth(messageHandler.CreateMessage, authMiddleware))
	r.GET("/api/chats/:id/messages", wrapWithAuth(messageHandler.GetMessages, authMiddleware))
	// SSE events stream per chat
	r.GET("/api/chats/:id/events", func(c *gin.Context) {
		c.Set("chatEventsSub", chatEventsAdapter{c: c, n: n})
		wrapWithAuth(messageHandler.Events, authMiddleware)(c)
	})

	// oauth flows (public endpoints)
	r.POST("/oauth/:provider/login", wrap(http.HandlerFunc(oauthHandler.Redirect)))
	r.GET("/oauth/:provider/callback", wrap(http.HandlerFunc(oauthHandler.Callback)))

	// Token management API (protected)
	r.GET("/api/token/:profile/:provider", wrapWithAuthHttp(oauthHandler.GetToken, authMiddleware))
	r.PUT("/api/token/:profile/:provider", wrapWithAuthHttp(oauthHandler.UpdateToken, authMiddleware))
	r.DELETE("/api/token/:profile/:provider", wrapWithAuthHttp(oauthHandler.Disconnect, authMiddleware))
	r.POST("/api/logs", wrapWithAuthHttp(oauthHandler.LogUsage, authMiddleware))
	r.PUT("/api/permissions/:profile/:provider", wrapWithAuthHttp(oauthHandler.UpdatePermissions, authMiddleware))

	// Additional Google-specific endpoints required by Swagger (protected)
	r.GET("/api/status/:profile/google", wrapWithAuthHttp(oauthHandler.StatusGoogle, authMiddleware))
	r.GET("/api/permissions/:profile/google", wrapWithAuthHttp(oauthHandler.GetPermissionsGoogle, authMiddleware))
	r.GET("/api/logs", wrapWithAuthHttp(oauthHandler.ListLogs, authMiddleware))
	r.POST("/api/disconnect/:profile/google", wrapWithAuthHttp(oauthHandler.DisconnectGooglePost, authMiddleware))
	r.POST("/api/oauth/google/login", wrapWithAuthHttp(oauthHandler.OAuthGoogleLogin, authMiddleware))
	r.POST("/api/oauth/google/reauthorize", wrapWithAuthHttp(oauthHandler.OAuthGoogleReauthorize, authMiddleware))

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
