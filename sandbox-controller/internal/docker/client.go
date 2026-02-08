package docker

import (
	"bytes"
	"context"
	"io"
	"time"

	"github.com/kliuchnikovv/genie-api/sandbox-controller/internal/config"
	"github.com/kliuchnikovv/genie-api/sandbox-controller/internal/sandbox"
)

// Client implements the sandbox.Backend interface using Docker
type Client struct {
	cfg *config.Config
}

// NewClient creates a new Docker client
func NewClient(cfg *config.Config) (*Client, error) {
	return &Client{
		cfg: cfg,
	}, nil
}

// CreateSandbox creates a container for the sandbox (simplified stub)
func (c *Client) CreateSandbox(ctx context.Context, sb *sandbox.Sandbox) error {
	// In a real implementation, this would use the Docker API
	// For now, this is a stub that allows local development
	return nil
}

// DestroySandbox destroys the container and optionally volumes
func (c *Client) DestroySandbox(ctx context.Context, podName string, deletePVC bool) error {
	return nil
}

// GetStatus returns the current status of the container
func (c *Client) GetStatus(ctx context.Context, podName string) (*sandbox.PodStatus, error) {
	return &sandbox.PodStatus{
		Phase: "Running",
		Ready: true,
	}, nil
}

// Exec executes a command in the container
func (c *Client) Exec(ctx context.Context, podName string, command []string, timeout time.Duration) (*sandbox.ExecResult, error) {
	return &sandbox.ExecResult{
		Stdout:   "Docker backend not fully implemented",
		Stderr:   "",
		ExitCode: 0,
	}, nil
}

// ExecStream executes a command and streams the output
func (c *Client) ExecStream(ctx context.Context, podName string, command []string) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader([]byte("Docker backend not fully implemented"))), nil
}

// Upload copies data to a file in the container
func (c *Client) Upload(ctx context.Context, podName string, path string, data io.Reader) error {
	return nil
}

// Download reads a file from the container
func (c *Client) Download(ctx context.Context, podName string, path string) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader([]byte{})), nil
}

// ListFiles lists files in a directory
func (c *Client) ListFiles(ctx context.Context, podName string, path string) ([]sandbox.FileInfo, error) {
	return []sandbox.FileInfo{}, nil
}
