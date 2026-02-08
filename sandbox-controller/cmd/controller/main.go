package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/sandbox-controller/internal/config"
	"github.com/kliuchnikovv/genie-api/sandbox-controller/internal/docker"
	"github.com/kliuchnikovv/genie-api/sandbox-controller/internal/handlers"
	"github.com/kliuchnikovv/genie-api/sandbox-controller/internal/k8s"
	"github.com/kliuchnikovv/genie-api/sandbox-controller/internal/sandbox"
	"go.uber.org/zap"
)

func main() {
	// Load configuration
	cfg := config.Load()

	// Create logger
	zapCfg := zap.NewProductionConfig()
	zapCfg.Level = zap.NewAtomicLevelAt(zap.InfoLevel)
	zapCfg.Encoding = "json"

	logger, err := zapCfg.Build()
	if err != nil {
		log.Fatalf("failed to create logger: %v", err)
	}
	defer logger.Sync()

	// Create backend
	var backend sandbox.Backend
	if cfg.Backend == "docker" {
		backend, err = docker.NewClient(cfg)
		if err != nil {
			logger.Fatal("failed to create docker client", zap.Error(err))
		}
		logger.Info("Using Docker backend")
	} else {
		backend, err = k8s.NewClient(cfg)
		if err != nil {
			logger.Fatal("failed to create kubernetes client", zap.Error(err))
		}
		logger.Info("Using Kubernetes backend")
	}

	// Create manager
	managerCfg := &sandbox.Config{
		InactivityTimeout: cfg.InactivityTimeout,
		PVCRetentionDays:  cfg.PVCRetentionDays,
	}
	manager := sandbox.NewManager(backend, logger, managerCfg)

	// Create GC
	gc := sandbox.NewGC(manager, backend, logger, managerCfg)
	gc.Start()
	defer gc.Stop()

	// Create handler
	handler := handlers.NewHandler(manager, logger)

	// Setup Gin
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(handlers.AuthMiddleware(cfg))

	// Routes
	r.POST("/api/sandboxes", handler.CreateSandbox)
	r.GET("/api/sandboxes/:id", handler.GetSandbox)
	r.POST("/api/sandboxes/:id/exec", handler.Exec)
	r.POST("/api/sandboxes/:id/upload", handler.Upload)
	r.GET("/api/sandboxes/:id/download", handler.Download)
	r.GET("/api/sandboxes/:id/files", handler.ListFiles)
	r.DELETE("/api/sandboxes/:id", handler.DestroySandbox)
	r.GET("/health", handler.HealthCheck)

	// Setup server
	srv := &http.Server{
		Addr:    ":" + string(rune(cfg.Port)),
		Handler: r,
	}

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		logger.Info("Sandbox controller is listening", zap.Int("port", cfg.Port))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server failed", zap.Error(err))
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
