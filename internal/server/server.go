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

func New(cfg *config.Config, db *storage.Storage) *http.Server {
    r := gin.New()

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
    r.GET("/api/auth/me", gin.WrapH(authMiddleware.RequireAuth(http.HandlerFunc(authHandler.GetMe))))

	// existing handlers are standard http handlers; wrap them so they work
	r.GET("/", gin.WrapF(http.HandlerFunc(handlers.HelloWorld)))

	// Chat API
	r.POST("/api/chats", chatHandler.CreateChat)
	r.GET("/api/chats/:id", chatHandler.GetChat)
	r.PUT("/api/chats/:id", chatHandler.UpdateChat)
	r.DELETE("/api/chats/:id", chatHandler.DeleteChat)

	// Message API
	r.POST("/api/chats/:id/messages", messageHandler.CreateMessage)
	r.GET("/api/chats/:id/messages", messageHandler.GetMessages)

	// oauth flows
	r.POST("/oauth/:provider/login", wrap(http.HandlerFunc(oauthHandler.Redirect)))
	r.GET("/oauth/:provider/callback", wrap(http.HandlerFunc(oauthHandler.Callback)))

    // Token management API
    r.GET("/api/token/:profile/:provider", wrap(http.HandlerFunc(oauthHandler.GetToken)))
    r.PUT("/api/token/:profile/:provider", wrap(http.HandlerFunc(oauthHandler.UpdateToken)))
    r.DELETE("/api/token/:profile/:provider", wrap(http.HandlerFunc(oauthHandler.Disconnect)))
    r.POST("/api/logs", wrap(http.HandlerFunc(oauthHandler.LogUsage)))
    r.PUT("/api/permissions/:profile/:provider", wrap(http.HandlerFunc(oauthHandler.UpdatePermissions)))

    // Additional Google-specific endpoints required by Swagger
    r.GET("/api/status/:profile/google", wrap(http.HandlerFunc(oauthHandler.StatusGoogle)))
    r.GET("/api/permissions/:profile/google", wrap(http.HandlerFunc(oauthHandler.GetPermissionsGoogle)))
    r.GET("/api/logs", wrap(http.HandlerFunc(oauthHandler.ListLogs)))
    r.POST("/api/disconnect/:profile/google", wrap(http.HandlerFunc(oauthHandler.DisconnectGooglePost)))
    r.POST("/api/oauth/google/login", wrap(http.HandlerFunc(oauthHandler.OAuthGoogleLogin)))
    r.POST("/api/oauth/google/reauthorize", wrap(http.HandlerFunc(oauthHandler.OAuthGoogleReauthorize)))

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
