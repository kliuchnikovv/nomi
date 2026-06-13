package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadGitHubAppConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	yaml := `
server:
  port: 8080
github:
  webhook_secret: "wh"
  app_id: 123456
  private_key: "PEMDATA"
  client_id: "cid"
  client_secret: "csecret"
  app_slug: "my-app"
`
	if err := os.WriteFile(path, []byte(yaml), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.GitHub.AppID != 123456 {
		t.Errorf("AppID = %d, want 123456", cfg.GitHub.AppID)
	}
	if cfg.GitHub.PrivateKey != "PEMDATA" {
		t.Errorf("PrivateKey = %q", cfg.GitHub.PrivateKey)
	}
	if cfg.GitHub.AppSlug != "my-app" {
		t.Errorf("AppSlug = %q", cfg.GitHub.AppSlug)
	}
}

func TestLoadGitHubAppDisabledWhenEmpty(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	// app_id absent -> int64 zero value -> feature disabled.
	if err := os.WriteFile(path, []byte("server:\n  port: 8080\n"), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.GitHub.AppID != 0 {
		t.Errorf("AppID = %d, want 0 (disabled)", cfg.GitHub.AppID)
	}
}
