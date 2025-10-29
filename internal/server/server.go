package server

import (
	"fmt"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/handlers"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

func New(cfg *config.Config, db *storage.Storage) *http.Server {
	router := mux.NewRouter()

	oauthHandler := handlers.NewOAuth(cfg, db)

	router.HandleFunc("/", handlers.HelloWorld)
	router.HandleFunc("/oauth/{provider}/login", oauthHandler.Redirect)
	router.HandleFunc("/oauth/{provider}/callback", oauthHandler.Callback)

	return &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.Server.Port),
		Handler: router,
	}
}
