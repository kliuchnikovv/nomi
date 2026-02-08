package sandbox

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Manager manages sandbox lifecycle with in-memory registry and scale-to-zero
type Manager struct {
	backend Backend
	logger  *zap.Logger
	config  *Config

	mu        sync.RWMutex
	sandboxes map[string]*Sandbox // key: sandbox ID
	userIndex map[string]string   // key: userID+projectID, value: sandbox ID
	timers    map[string]*time.Timer
}

// Config holds manager configuration
type Config struct {
	InactivityTimeout time.Duration
	PVCRetentionDays  int
}

// NewManager creates a new sandbox manager
func NewManager(backend Backend, logger *zap.Logger, config *Config) *Manager {
	return &Manager{
		backend:   backend,
		logger:    logger,
		config:    config,
		sandboxes: make(map[string]*Sandbox),
		userIndex: make(map[string]string),
		timers:    make(map[string]*time.Timer),
	}
}

// CreateSandbox creates a new sandbox for a user
func (m *Manager) CreateSandbox(ctx context.Context, userID, projectID string) (*Sandbox, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check if sandbox already exists for this user+project
	key := m.userProjectKey(userID, projectID)
	if existingID, exists := m.userIndex[key]; exists {
		if sb, ok := m.sandboxes[existingID]; ok {
			return sb, nil
		}
	}

	sb := &Sandbox{
		ID:           uuid.New().String(),
		UserID:       userID,
		ProjectID:    projectID,
		PodName:      fmt.Sprintf("sandbox-%s", uuid.New().String()[:8]),
		PVCName:      fmt.Sprintf("pvc-%s", uuid.New().String()[:8]),
		Status:       StatusPending,
		LastActivity: time.Now(),
		CreatedAt:    time.Now(),
	}

	m.sandboxes[sb.ID] = sb
	m.userIndex[key] = sb.ID

	// Create in backend
	if err := m.backend.CreateSandbox(ctx, sb); err != nil {
		delete(m.sandboxes, sb.ID)
		delete(m.userIndex, key)
		return nil, fmt.Errorf("failed to create sandbox: %w", err)
	}

	sb.Status = StatusRunning
	m.startInactivityTimer(sb.ID)

	m.logger.Info("Created sandbox",
		zap.String("sandbox_id", sb.ID),
		zap.String("user_id", userID),
		zap.String("project_id", projectID),
	)

	return sb, nil
}

// GetSandbox retrieves a sandbox by ID
func (m *Manager) GetSandbox(id string) (*Sandbox, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	sb, ok := m.sandboxes[id]
	if !ok {
		return nil, fmt.Errorf("sandbox not found: %s", id)
	}

	return sb, nil
}

// GetOrCreateSandbox gets existing sandbox or creates new one
func (m *Manager) GetOrCreateSandbox(ctx context.Context, userID, projectID string) (*Sandbox, error) {
	m.mu.Lock()
	key := m.userProjectKey(userID, projectID)
	if existingID, exists := m.userIndex[key]; exists {
		if sb, ok := m.sandboxes[existingID]; ok {
			m.mu.Unlock()
			return sb, nil
		}
	}
	m.mu.Unlock()

	return m.CreateSandbox(ctx, userID, projectID)
}

// EnsureRunning ensures the sandbox pod is running (creates if needed)
func (m *Manager) EnsureRunning(ctx context.Context, sandboxID string) error {
	m.mu.Lock()
	sb, ok := m.sandboxes[sandboxID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("sandbox not found: %s", sandboxID)
	}
	m.mu.Unlock()

	// Check pod status
	status, err := m.backend.GetStatus(ctx, sb.PodName)
	if err != nil {
		m.logger.Warn("Failed to get pod status, recreating sandbox",
			zap.String("sandbox_id", sandboxID),
			zap.Error(err),
		)
		// Recreate the sandbox
		if err := m.backend.CreateSandbox(ctx, sb); err != nil {
			return fmt.Errorf("failed to recreate sandbox: %w", err)
		}
		sb.Status = StatusRunning
	} else if status.Phase != "Running" {
		m.logger.Info("Pod not running, recreating",
			zap.String("sandbox_id", sandboxID),
			zap.String("phase", status.Phase),
		)
		// Delete and recreate
		_ = m.backend.DestroySandbox(ctx, sb.PodName, false) // keep PVC
		if err := m.backend.CreateSandbox(ctx, sb); err != nil {
			return fmt.Errorf("failed to recreate sandbox: %w", err)
		}
		sb.Status = StatusRunning
	}

	m.updateActivity(sandboxID)
	return nil
}

// Exec executes a command in the sandbox
func (m *Manager) Exec(ctx context.Context, sandboxID string, command []string, timeout time.Duration) (*ExecResult, error) {
	if err := m.EnsureRunning(ctx, sandboxID); err != nil {
		return nil, err
	}

	sb, err := m.GetSandbox(sandboxID)
	if err != nil {
		return nil, err
	}

	result, err := m.backend.Exec(ctx, sb.PodName, command, timeout)
	if err != nil {
		return nil, err
	}

	m.updateActivity(sandboxID)
	return result, nil
}

// ExecStream executes a command with streaming output
func (m *Manager) ExecStream(ctx context.Context, sandboxID string, command []string) (io.ReadCloser, error) {
	if err := m.EnsureRunning(ctx, sandboxID); err != nil {
		return nil, err
	}

	sb, err := m.GetSandbox(sandboxID)
	if err != nil {
		return nil, err
	}

	reader, err := m.backend.ExecStream(ctx, sb.PodName, command)
	if err != nil {
		return nil, err
	}

	m.updateActivity(sandboxID)
	return reader, nil
}

// Upload uploads a file to the sandbox
func (m *Manager) Upload(ctx context.Context, sandboxID string, path string, data []byte) error {
	if err := m.EnsureRunning(ctx, sandboxID); err != nil {
		return err
	}

	sb, err := m.GetSandbox(sandboxID)
	if err != nil {
		return err
	}

	if err := m.backend.Upload(ctx, sb.PodName, path, bytes.NewReader(data)); err != nil {
		return err
	}

	m.updateActivity(sandboxID)
	return nil
}

// Download downloads a file from the sandbox
func (m *Manager) Download(ctx context.Context, sandboxID string, path string) (io.ReadCloser, error) {
	if err := m.EnsureRunning(ctx, sandboxID); err != nil {
		return nil, err
	}

	sb, err := m.GetSandbox(sandboxID)
	if err != nil {
		return nil, err
	}

	reader, err := m.backend.Download(ctx, sb.PodName, path)
	if err != nil {
		return nil, err
	}

	m.updateActivity(sandboxID)
	return reader, nil
}

// ListFiles lists files in a directory
func (m *Manager) ListFiles(ctx context.Context, sandboxID string, path string) ([]FileInfo, error) {
	if err := m.EnsureRunning(ctx, sandboxID); err != nil {
		return nil, err
	}

	sb, err := m.GetSandbox(sandboxID)
	if err != nil {
		return nil, err
	}

	files, err := m.backend.ListFiles(ctx, sb.PodName, path)
	if err != nil {
		return nil, err
	}

	m.updateActivity(sandboxID)
	return files, nil
}

// DestroySandbox destroys a sandbox and optionally its PVC
func (m *Manager) DestroySandbox(ctx context.Context, sandboxID string, deletePVC bool) error {
	m.mu.Lock()
	sb, ok := m.sandboxes[sandboxID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("sandbox not found: %s", sandboxID)
	}

	// Cancel inactivity timer
	if timer, ok := m.timers[sandboxID]; ok {
		timer.Stop()
		delete(m.timers, sandboxID)
	}

	key := m.userProjectKey(sb.UserID, sb.ProjectID)
	delete(m.userIndex, key)
	delete(m.sandboxes, sandboxID)
	m.mu.Unlock()

	if err := m.backend.DestroySandbox(ctx, sb.PodName, deletePVC); err != nil {
		return fmt.Errorf("failed to destroy sandbox: %w", err)
	}

	m.logger.Info("Destroyed sandbox",
		zap.String("sandbox_id", sandboxID),
		zap.Bool("pvc_deleted", deletePVC),
	)

	return nil
}

// updateActivity updates the last activity time and resets the timer
func (m *Manager) updateActivity(sandboxID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	sb, ok := m.sandboxes[sandboxID]
	if !ok {
		return
	}

	sb.LastActivity = time.Now()
	m.startInactivityTimer(sandboxID)
}

// startInactivityTimer starts or resets the inactivity timer for a sandbox
func (m *Manager) startInactivityTimer(sandboxID string) {
	if timer, ok := m.timers[sandboxID]; ok {
		timer.Stop()
	}

	timeout := m.config.InactivityTimeout
	if timeout <= 0 {
		timeout = 15 * time.Minute
	}

	m.timers[sandboxID] = time.AfterFunc(timeout, func() {
		m.handleInactivity(sandboxID)
	})
}

// handleInactivity handles sandbox inactivity by stopping the pod
func (m *Manager) handleInactivity(sandboxID string) {
	m.mu.Lock()
	sb, ok := m.sandboxes[sandboxID]
	if !ok {
		m.mu.Unlock()
		return
	}
	m.mu.Unlock()

	m.logger.Info("Sandbox inactive, stopping pod",
		zap.String("sandbox_id", sandboxID),
		zap.Duration("inactive_for", time.Since(sb.LastActivity)),
	)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Delete pod but keep PVC
	if err := m.backend.DestroySandbox(ctx, sb.PodName, false); err != nil {
		m.logger.Error("Failed to stop inactive sandbox",
			zap.String("sandbox_id", sandboxID),
			zap.Error(err),
		)
		return
	}

	m.mu.Lock()
	if sb, ok := m.sandboxes[sandboxID]; ok {
		sb.Status = StatusStopped
	}
	m.mu.Unlock()
}

// userProjectKey creates a unique key for user+project
func (m *Manager) userProjectKey(userID, projectID string) string {
	if projectID == "" {
		return userID
	}
	return userID + ":" + projectID
}

// GetAllSandboxes returns all sandboxes (for GC)
func (m *Manager) GetAllSandboxes() []*Sandbox {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]*Sandbox, 0, len(m.sandboxes))
	for _, sb := range m.sandboxes {
		result = append(result, sb)
	}
	return result
}
