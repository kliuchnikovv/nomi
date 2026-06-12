// Package local implements the sandbox.Backend interface by running commands as
// subprocesses inside the controller's own container.
//
// This backend is the only one that works on platforms that forbid privileged
// containers, Docker socket access, and Kubernetes (e.g. Railway). It trades
// kernel-level isolation for portability: each sandbox is a directory under
// SANDBOX_ROOT, and commands run as subprocesses with a scrubbed environment and
// (optionally) a dropped uid/gid. Suitable for personal/trusted use; for hostile
// multi-tenant code, swap in a microVM backend (E2B / Fly Machines) — the
// sandbox.Backend interface stays the same.
package local

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/kliuchnikovv/genie-api/sandbox-controller/internal/config"
	"github.com/kliuchnikovv/genie-api/sandbox-controller/internal/sandbox"
)

// maxOutputBytes caps captured stdout/stderr per stream to avoid OOM from a
// runaway command (e.g. `cat /dev/urandom`).
const maxOutputBytes = 8 << 20 // 8 MiB

// Client implements sandbox.Backend using local subprocesses.
type Client struct {
	cfg *config.Config
}

// NewClient creates a new local backend client.
func NewClient(cfg *config.Config) (*Client, error) {
	if err := os.MkdirAll(cfg.Root, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create sandbox root %q: %w", cfg.Root, err)
	}
	return &Client{cfg: cfg}, nil
}

// boxRoot is the per-sandbox base directory (holds the workspace).
func (c *Client) boxRoot(podName string) string {
	return filepath.Join(c.cfg.Root, podName)
}

// workspaceDir is the working directory exposed to the agent as /workspace.
func (c *Client) workspaceDir(podName string) string {
	return filepath.Join(c.boxRoot(podName), "workspace")
}

// CreateSandbox creates the workspace directory for the sandbox (idempotent).
func (c *Client) CreateSandbox(ctx context.Context, sb *sandbox.Sandbox) error {
	ws := c.workspaceDir(sb.PodName)
	if err := os.MkdirAll(ws, 0o755); err != nil {
		return fmt.Errorf("failed to create workspace: %w", err)
	}
	if c.cfg.UID > 0 {
		// Best-effort: let the unprivileged sandbox user own its files.
		_ = os.Chown(c.boxRoot(sb.PodName), c.cfg.UID, c.cfg.GID)
		_ = os.Chown(ws, c.cfg.UID, c.cfg.GID)
	}
	return nil
}

// DestroySandbox removes the workspace only when deletePVC is true. A false value
// (used by the inactivity GC) is a no-op so files persist across sessions.
func (c *Client) DestroySandbox(ctx context.Context, podName string, deletePVC bool) error {
	if !deletePVC {
		return nil
	}
	if err := os.RemoveAll(c.boxRoot(podName)); err != nil {
		return fmt.Errorf("failed to remove sandbox dir: %w", err)
	}
	return nil
}

// GetStatus reports Running when the workspace directory exists, Stopped otherwise.
// A Stopped status makes Manager.EnsureRunning recreate the directory transparently.
func (c *Client) GetStatus(ctx context.Context, podName string) (*sandbox.PodStatus, error) {
	if _, err := os.Stat(c.workspaceDir(podName)); err != nil {
		return &sandbox.PodStatus{Phase: "Stopped", Ready: false}, nil
	}
	return &sandbox.PodStatus{Phase: "Running", Ready: true}, nil
}

// Exec runs a command in the sandbox workspace and returns its real exit code.
func (c *Client) Exec(ctx context.Context, podName string, command []string, timeout time.Duration) (*sandbox.ExecResult, error) {
	if len(command) == 0 {
		return nil, errors.New("empty command")
	}

	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := c.command(execCtx, podName, command)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &cappedWriter{buf: &stdout}
	cmd.Stderr = &cappedWriter{buf: &stderr}

	runErr := cmd.Run()

	result := &sandbox.ExecResult{
		Stdout: stdout.String(),
		Stderr: stderr.String(),
	}

	// Timeout: the context deadline killed the process group. Report 124 (the
	// conventional `timeout(1)` exit code) so the agent can tell it apart.
	if execCtx.Err() == context.DeadlineExceeded {
		result.ExitCode = 124
		if result.Stderr != "" {
			result.Stderr += "\n"
		}
		result.Stderr += fmt.Sprintf("command timed out after %s", timeout)
		return result, nil
	}

	result.ExitCode = exitCode(runErr)
	return result, nil
}

// ExecStream runs a command and streams combined stdout+stderr.
func (c *Client) ExecStream(ctx context.Context, podName string, command []string) (io.ReadCloser, error) {
	if len(command) == 0 {
		return nil, errors.New("empty command")
	}

	cmd := c.command(ctx, podName, command)
	reader, writer := io.Pipe()
	cmd.Stdout = writer
	cmd.Stderr = writer

	if err := cmd.Start(); err != nil {
		writer.Close()
		return nil, fmt.Errorf("failed to start command: %w", err)
	}

	go func() {
		err := cmd.Wait()
		// Surface a trailing exit-code line, then close the stream.
		if code := exitCode(err); code != 0 {
			fmt.Fprintf(writer, "\n[exit code: %d]", code)
		}
		writer.Close()
	}()

	return reader, nil
}

// Upload writes data to a file inside the workspace.
func (c *Client) Upload(ctx context.Context, podName string, path string, data io.Reader) error {
	abs, err := c.resolvePath(podName, path)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return fmt.Errorf("failed to create parent dir: %w", err)
	}
	f, err := os.Create(abs)
	if err != nil {
		return fmt.Errorf("failed to create file: %w", err)
	}
	defer f.Close()
	if _, err := io.Copy(f, data); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}
	if c.cfg.UID > 0 {
		_ = os.Chown(abs, c.cfg.UID, c.cfg.GID)
	}
	return nil
}

// Download opens a file inside the workspace for reading.
func (c *Client) Download(ctx context.Context, podName string, path string) (io.ReadCloser, error) {
	abs, err := c.resolvePath(podName, path)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(abs)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	return f, nil
}

// ListFiles lists files in a directory inside the workspace.
func (c *Client) ListFiles(ctx context.Context, podName string, path string) ([]sandbox.FileInfo, error) {
	abs, err := c.resolvePath(podName, path)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil, fmt.Errorf("failed to read dir: %w", err)
	}

	files := make([]sandbox.FileInfo, 0, len(entries))
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, sandbox.FileInfo{
			Name:  e.Name(),
			Path:  filepath.Join(path, e.Name()),
			Size:  info.Size(),
			IsDir: e.IsDir(),
			Mode:  info.Mode().String(),
		})
	}
	return files, nil
}

// command builds an *exec.Cmd with the workspace as cwd, a scrubbed environment,
// its own process group (for timeout kills), and an optional dropped uid/gid.
func (c *Client) command(ctx context.Context, podName string, command []string) *exec.Cmd {
	ws := c.workspaceDir(podName)
	cmd := exec.CommandContext(ctx, command[0], command[1:]...)
	cmd.Dir = ws

	// Minimal, secret-free environment so agent code can't read the controller's
	// token or other configuration from the process env.
	cmd.Env = []string{
		"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
		"HOME=" + ws,
		"LANG=C.UTF-8",
		"USER=sandbox",
	}

	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if c.cfg.UID > 0 {
		cmd.SysProcAttr.Credential = &syscall.Credential{
			Uid: uint32(c.cfg.UID),
			Gid: uint32(c.cfg.GID),
		}
	}
	// Kill the whole process group when the context is cancelled so children
	// don't outlive a timed-out command.
	cmd.Cancel = func() error {
		if cmd.Process != nil {
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		}
		return cmd.Process.Kill()
	}
	return cmd
}

// resolvePath maps an agent-supplied path to an absolute path that is guaranteed
// to live inside the sandbox workspace. The "/workspace" prefix is treated as the
// workspace root; any path escaping the workspace (via "..") is rejected.
func (c *Client) resolvePath(podName, path string) (string, error) {
	ws := c.workspaceDir(podName)

	p := strings.TrimSpace(path)
	if p == "" {
		return ws, nil
	}
	// Treat absolute /workspace paths as workspace-relative.
	p = strings.TrimPrefix(p, "/workspace")
	p = strings.TrimPrefix(p, "/")

	abs := filepath.Join(ws, filepath.Clean("/"+p))
	rel, err := filepath.Rel(ws, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path %q escapes the sandbox workspace", path)
	}
	return abs, nil
}

// exitCode extracts the process exit code from an error returned by Cmd.Run/Wait.
func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	// Failed to start (binary not found, etc.).
	return 127
}

// cappedWriter discards everything past maxOutputBytes to bound memory usage.
type cappedWriter struct {
	buf     *bytes.Buffer
	written int
}

func (w *cappedWriter) Write(p []byte) (int, error) {
	if w.written >= maxOutputBytes {
		return len(p), nil
	}
	remaining := maxOutputBytes - w.written
	if len(p) > remaining {
		w.buf.Write(p[:remaining])
		w.written = maxOutputBytes
		return len(p), nil
	}
	w.buf.Write(p)
	w.written += len(p)
	return len(p), nil
}
