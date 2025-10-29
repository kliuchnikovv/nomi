package server

import (
	"net/http"

	"github.com/kliuchnikovv/genie-api/internal/handlers"
)

func New() *http.Server {
	router := http.NewServeMux()

	router.HandleFunc("/", handlers.HelloWorld)

	return &http.Server{
		Addr:    ":8080",
		Handler: router,
	}
}
