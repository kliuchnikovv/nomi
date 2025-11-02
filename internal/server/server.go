package server

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/mux"
	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/handlers"
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

func New(cfg *config.Config, db *storage.Storage) *http.Server {
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	// Инициализация обработчиков
	tokenManager := auth.NewTokenManager(cfg.Token.JWTSecret)
	authMiddleware := auth.NewAuthMiddleware(tokenManager, db)
	authHandler := handlers.NewAuthHandler(db, tokenManager)
	oauthHandler := handlers.NewOAuth(cfg, db)
	chatHandler := handlers.NewChatHandler(db)
	messageHandler := handlers.NewMessageHandler(db)

	// Auth API
	r.POST("/api/auth/register", wrap(http.HandlerFunc(authHandler.Register)))
	r.POST("/api/auth/login", wrap(http.HandlerFunc(authHandler.Login)))
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

	// Message API (protected)
	r.POST("/api/chats/:id/messages", wrapWithAuth(messageHandler.CreateMessage, authMiddleware))
	r.GET("/api/chats/:id/messages", wrapWithAuth(messageHandler.GetMessages, authMiddleware))

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
