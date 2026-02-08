package sandbox

import (
	"context"
	"time"

	"go.uber.org/zap"
)

// GC runs garbage collection for sandboxes
type GC struct {
	manager *Manager
	backend Backend
	logger  *zap.Logger
	config  *Config
	stopCh  chan struct{}
}

// GCConfig holds GC configuration
type GCConfig struct {
	InactivityTimeout time.Duration
	PVCRetentionDays  int
}

// NewGC creates a new garbage collector
func NewGC(manager *Manager, backend Backend, logger *zap.Logger, config *Config) *GC {
	return &GC{
		manager: manager,
		backend: backend,
		logger:  logger,
		config:  config,
		stopCh:  make(chan struct{}),
	}
}

// Start starts the GC goroutine
func (gc *GC) Start() {
	go gc.run()
}

// Stop stops the GC goroutine
func (gc *GC) Stop() {
	close(gc.stopCh)
}

func (gc *GC) run() {
	inactivityTicker := time.NewTicker(60 * time.Second)
	defer inactivityTicker.Stop()

	pvcTicker := time.NewTicker(24 * time.Hour)
	defer pvcTicker.Stop()

	for {
		select {
		case <-gc.stopCh:
			return
		case <-inactivityTicker.C:
			gc.checkInactiveSandboxes()
		case <-pvcTicker.C:
			gc.cleanupPVCs()
		}
	}
}

// checkInactiveSandboxes checks for sandboxes that have been inactive
func (gc *GC) checkInactiveSandboxes() {
	sandboxes := gc.manager.GetAllSandboxes()
	now := time.Now()

	for _, sb := range sandboxes {
		if sb.Status != StatusRunning {
			continue
		}

		inactiveDuration := now.Sub(sb.LastActivity)
		if inactiveDuration > gc.config.InactivityTimeout {
			gc.logger.Info("GC: Stopping inactive sandbox",
				zap.String("sandbox_id", sb.ID),
				zap.Duration("inactive_for", inactiveDuration),
			)

			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			if err := gc.manager.DestroySandbox(ctx, sb.ID, false); err != nil {
				gc.logger.Error("GC: Failed to stop inactive sandbox",
					zap.String("sandbox_id", sb.ID),
					zap.Error(err),
				)
			}
			cancel()
		}
	}
}

// cleanupPVCs performs daily cleanup of old PVCs
func (gc *GC) cleanupPVCs() {
	// This would need to be implemented based on the backend
	// For K8s, we'd list PVCs with specific labels and delete those older than retention period
	gc.logger.Info("GC: PVC cleanup not yet implemented")
}
