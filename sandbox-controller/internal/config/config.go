package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds all configuration for the sandbox controller
type Config struct {
	// Server
	Port            int
	ControllerToken string

	// Kubernetes
	Namespace      string
	KubeconfigPath string
	InCluster      bool

	// Sandbox defaults
	DefaultImage      string
	InactivityTimeout time.Duration
	PVCRetentionDays  int
	MaxCPU            string
	MaxMemory         string
	MaxPods           int

	// Local backend: base directory for per-sandbox workspaces and optional
	// uid/gid to drop privileges to when running commands (0 = no drop).
	Root string
	UID  int
	GID  int

	// Backend type: "local" (default), "k8s", or "docker"
	Backend string
}

// Load loads configuration from environment variables
func Load() *Config {
	cfg := &Config{
		Port:              getEnvInt("PORT", 8090),
		ControllerToken:   getEnvString("SANDBOX_CONTROLLER_TOKEN", ""),
		Namespace:         getEnvString("SANDBOX_NAMESPACE", "genie-sandboxes"),
		KubeconfigPath:    getEnvString("KUBECONFIG", ""),
		InCluster:         getEnvBool("IN_CLUSTER", false),
		DefaultImage:      getEnvString("SANDBOX_IMAGE", "ubuntu:22.04"),
		InactivityTimeout: getEnvDuration("SANDBOX_INACTIVITY_TIMEOUT", 15*time.Minute),
		PVCRetentionDays:  getEnvInt("SANDBOX_PVC_RETENTION_DAYS", 30),
		MaxCPU:            getEnvString("SANDBOX_MAX_CPU", "1"),
		MaxMemory:         getEnvString("SANDBOX_MAX_MEMORY", "512Mi"),
		MaxPods:           getEnvInt("SANDBOX_MAX_PODS", 100),
		Root:              getEnvString("SANDBOX_ROOT", "/sandboxes"),
		UID:               getEnvInt("SANDBOX_UID", 0),
		GID:               getEnvInt("SANDBOX_GID", 0),
		Backend:           getEnvString("SANDBOX_BACKEND", "local"),
	}

	return cfg
}

func getEnvString(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}

func getEnvBool(key string, defaultVal bool) bool {
	if val := os.Getenv(key); val != "" {
		if b, err := strconv.ParseBool(val); err == nil {
			return b
		}
	}
	return defaultVal
}

func getEnvDuration(key string, defaultVal time.Duration) time.Duration {
	if val := os.Getenv(key); val != "" {
		if d, err := time.ParseDuration(val); err == nil {
			return d
		}
	}
	return defaultVal
}
