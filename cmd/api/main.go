package main

import (
	"fmt"
	"log"

	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/server"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

func main() {
	cfg, err := config.Load("configs/config.yaml")
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	db, err := storage.New(cfg)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}

	srv := server.New(cfg, db)

	fmt.Printf("Server is listening on port %d\n", cfg.Server.Port)
	srv.ListenAndServe()
}