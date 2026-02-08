package sandbox

import (
	"context"
	"io"
	"time"
)

// Status represents the current state of a sandbox
type Status string

const (
	StatusPending    Status = "pending"
	StatusRunning    Status = "running"
	StatusStopped    Status = "stopped"
	StatusError      Status = "error"
	StatusDestroying Status = "destroying"
)

// Sandbox represents a sandbox instance
type Sandbox struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	ProjectID    string    `json:"project_id,omitempty"`
	PodName      string    `json:"pod_name"`
	PVCName      string    `json:"pvc_name"`
	Status       Status    `json:"status"`
	LastActivity time.Time `json:"last_activity"`
	CreatedAt    time.Time `json:"created_at"`
}

// ExecResult contains the result of a command execution
type ExecResult struct {
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode int    `json:"exit_code"`
}

// PodStatus represents the status of a pod
type PodStatus struct {
	Phase     string    `json:"phase"`
	Ready     bool      `json:"ready"`
	StartTime time.Time `json:"start_time,omitempty"`
	Message   string    `json:"message,omitempty"`
	Reason    string    `json:"reason,omitempty"`
}

// Backend defines the interface for sandbox backends (K8s, Docker, etc.)
type Backend interface {
	// CreateSandbox creates the pod and PVC for a sandbox
	CreateSandbox(ctx context.Context, sandbox *Sandbox) error

	// DestroySandbox removes the pod and optionally the PVC
	DestroySandbox(ctx context.Context, podName string, deletePVC bool) error

	// GetStatus returns the current status of the pod
	GetStatus(ctx context.Context, podName string) (*PodStatus, error)

	// Exec executes a command in the sandbox
	Exec(ctx context.Context, podName string, command []string, timeout time.Duration) (*ExecResult, error)

	// ExecStream executes a command and streams the output
	ExecStream(ctx context.Context, podName string, command []string) (io.ReadCloser, error)

	// Upload copies data to a file in the sandbox
	Upload(ctx context.Context, podName string, path string, data io.Reader) error

	// Download reads a file from the sandbox
	Download(ctx context.Context, podName string, path string) (io.ReadCloser, error)

	// ListFiles lists files in a directory
	ListFiles(ctx context.Context, podName string, path string) ([]FileInfo, error)
}

// FileInfo represents information about a file
type FileInfo struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Size  int64  `json:"size"`
	IsDir bool   `json:"is_dir"`
	Mode  string `json:"mode"`
}
