package main

//go:generate swag init -g ./internal/handlers/oauth.go -o ./docs

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/kliuchnikovv/nomi-api/internal/config"
	"github.com/kliuchnikovv/nomi-api/internal/container"
	"github.com/kliuchnikovv/nomi-api/internal/handlers"
	"github.com/kliuchnikovv/nomi-api/internal/integrations"
	"github.com/kliuchnikovv/nomi-api/internal/llm"
	"github.com/kliuchnikovv/nomi-api/internal/plugins"
	"github.com/kliuchnikovv/nomi-api/internal/agenttask"
	"github.com/kliuchnikovv/nomi-api/internal/proactive"
	"github.com/kliuchnikovv/nomi-api/internal/scheduler"
	"github.com/kliuchnikovv/nomi-api/internal/server"
	"go.uber.org/zap"
)

// @title Nomi API
// @version 1.0
// @description API for Nomi (OAuth token management)
// @host localhost
// @BasePath /
func main() {
	// Determine which config to use
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

	pluginsDir := cfg.PluginsDir
	if pluginsDir == "" {
		pluginsDir = os.Getenv("PLUGINS_DIR")
	}
	if pluginsDir == "" {
		pluginsDir = "../plugins" // repo root when run from api/
	}
	// In Docker/Railway binary runs from /app; default "../plugins" resolves to /plugins (missing).
	// Prefer /app/plugins when the resolved path does not exist.
	if absDir, err := filepath.Abs(pluginsDir); err == nil {
		if _, err := os.Stat(absDir); os.IsNotExist(err) {
			const containerPlugins = "/app/plugins"
			if _, err := os.Stat(containerPlugins); err == nil {
				pluginsDir = containerPlugins
			}
		}
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

	if err := integrations.InitRegistry(pluginsDir, logger); err != nil {
		logger.Fatal("failed to init plugin registry", zap.Error(err))
	}

	if _, err := plugins.Load(pluginsDir, logger); err != nil {
		logger.Warn("failed to load plugin manifests", zap.Error(err))
	} else {
		logger.Info("loaded plugin manifests", zap.Int("count", len(plugins.Manifests)))
	}

	// Create DI Container
	ctr, err := container.NewContainer(cfg, logger)
	if err != nil {
		logger.Fatal("failed to create container: %v", zap.Error(err))
	}

	llmService := llm.NewService(cfg.LLM.BaseURL)

	oauthConfigs, oidcProviders, err := handlers.BuildOAuthResources(logger, cfg)
	if err != nil {
		logger.Fatal("failed to initialize oauth providers", zap.Error(err))
	}

	srv := server.New(logger, cfg, ctr, oauthConfigs, oidcProviders, llmService)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	notifScheduler := scheduler.New(ctr.Storage, logger, ctr.Hub.Redis())
	go notifScheduler.Start(ctx)

	decisionListener := proactive.NewDecisionListener(ctr.Storage, ctr.Hub.Redis(), logger)
	go func() {
		if err := decisionListener.Start(ctx); err != nil && err != context.Canceled {
			logger.Error("decision listener stopped", zap.Error(err))
		}
	}()

	agentTaskListener := agenttask.NewListener(ctr.Storage, ctr.Hub.Redis(), logger)
	go func() {
		if err := agentTaskListener.Start(ctx); err != nil && err != context.Canceled {
			logger.Error("agent task listener stopped", zap.Error(err))
		}
	}()

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
