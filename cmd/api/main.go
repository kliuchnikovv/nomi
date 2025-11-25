package main

//go:generate swag init -g ./internal/handlers/oauth.go -o ./docs

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/exec"

	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/daemon"
	"github.com/kliuchnikovv/genie-api/internal/handlers"
	"github.com/kliuchnikovv/genie-api/internal/integrations"
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
	configPath := "configs/config.yaml"
	if os.Getenv("RAILWAY_ENVIRONMENT") != "" {
		configPath = "configs/config.railway.yaml"
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

	llmService, err := llm.NewService(logger, cfg, db)
	if err != nil {
		logger.Fatal("failed to init llm service: %v", zap.Error(err))
	}

	oauthConfigs, oidcProviders, err := handlers.BuildOAuthResources(logger, cfg)
	if err != nil {
		logger.Fatal("failed to initialize oauth providers", zap.Error(err))
	}

	imapService := integrations.NewGmailIMAPService(logger, db, llmService)
	imapDaemon := daemon.NewIMAPDaemon(logger, db, imapService, oauthConfigs)
	inboxDaemon := daemon.NewInboxDaemon(logger, db, imapService)

	// Start daemons
	go func() {
		if err := imapDaemon.Start(context.Background()); err != nil {
			logger.Error("imap daemon failed", zap.Error(err))
		}
	}()

	go inboxDaemon.Start(context.Background())

	srv := server.New(logger, cfg, db, imapDaemon, oauthConfigs, oidcProviders, llmService, imapService)

	logger.Info("Server is listening", zap.Int("port", cfg.Server.Port))
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Fatal("server failed: %v", zap.Error(err))
	}
}
