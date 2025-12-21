package main

//go:generate swag init -g ./internal/handlers/oauth.go -o ./docs

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/handlers"
	"github.com/kliuchnikovv/genie-api/internal/llm"
	"github.com/kliuchnikovv/genie-api/internal/server"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

// @title Genie API
// @version 1.0
// @description API for Genie (OAuth token management)
// @host localhost
// @BasePath /
func main() {
	// Определяем какой конфиг использовать
	configPath := "./config.yaml"
	if os.Getenv("RAILWAY_ENVIRONMENT") != "" {
		// In Docker/Railway, config is in the same directory as the binary
		configPath = "./config.railway.yaml"
		log.Printf("Running in Railway environment, using %s", configPath)
	}

	cfg, err := config.Load(configPath)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	zapCfg := zap.NewProductionConfig()
	zapCfg.Level = zap.NewAtomicLevelAt(zap.DebugLevel)
	zapCfg.Encoding = "json"

	logger, err := zapCfg.Build()
	if err != nil {
		log.Fatalf("failed to create logger: %v", err)
	}
	defer logger.Sync()

	// Auto-generate Swagger docs before starting the server unless SKIP_SWAG=1
	if os.Getenv("SKIP_SWAG") != "1" {
		cmd := exec.Command("swag", "init", "-g", "./internal/handlers/oauth.go", "-o", "./docs")
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			logger.Error("warning: swag generation failed", zap.Error(err))
		} else {
			logger.Info("swagger docs generated into ./docs")
		}
	} else {
		logger.Info("skipping swagger generation due to SKIP_SWAG=1")
	}

	db, err := storage.New(cfg)
	if err != nil {
		logger.Fatal("failed to connect to database: %v", zap.Error(err))
	}

	llmService := llm.NewService(cfg.LLM.BaseURL)

	oauthConfigs, oidcProviders, err := handlers.BuildOAuthResources(logger, cfg)
	if err != nil {
		logger.Fatal("failed to initialize oauth providers", zap.Error(err))
	}

	srv := server.New(logger, cfg, db, oauthConfigs, oidcProviders, llmService)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		logger.Info("Server is listening", zap.Int("port", cfg.Server.Port))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server failed: %v", zap.Error(err))
		}
	}()

	<-ctx.Done()
	stop()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("graceful shutdown failed: %v", err)
	}
	log.Println("server shut down gracefully")
}
