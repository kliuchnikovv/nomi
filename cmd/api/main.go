package main

//go:generate swag init -g ./internal/handlers/oauth.go -o ./docs

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"

	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/server"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// @title Genie API
// @version 1.0
// @description API for Genie (OAuth token management)
// @host localhost
// @BasePath /
func main() {
	cfg, err := config.Load("configs/config.yaml")
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	// Auto-generate Swagger docs before starting the server unless SKIP_SWAG=1
	if os.Getenv("SKIP_SWAG") != "1" {
		cmd := exec.Command("swag", "init", "-g", "./internal/handlers/oauth.go", "-o", "./docs")
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			log.Printf("warning: swag generation failed: %v", err)
		} else {
			log.Printf("swagger docs generated into ./docs")
		}
	} else {
		log.Printf("skipping swagger generation due to SKIP_SWAG=1")
	}

	db, err := storage.New(cfg)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}

	srv := server.New(cfg, db)

	fmt.Printf("Server is listening on port %d\n", cfg.Server.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server failed: %v", err)
	}
}
