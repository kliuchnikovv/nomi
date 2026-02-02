package plugins

import (
	"os"
	"path/filepath"

	"go.uber.org/zap"
	"gopkg.in/yaml.v3"
)

// Manifest represents the plugin manifest schema (manifest.yaml).
// JSON tags match the API response; YAML tags match manifest.yaml.
type Manifest struct {
	Name        string `yaml:"name" json:"name"`
	DisplayName string `yaml:"display_name" json:"display_name"`
	Description string `yaml:"description" json:"description"`

	Execution struct {
		Type string `yaml:"type" json:"type"` // client, server, hybrid
	} `yaml:"execution" json:"execution"`

	Auth struct {
		Type           string   `yaml:"type" json:"type"`
		OAuthConfigKey string   `yaml:"oauth_config_key" json:"oauth_config_key"`
		OIDCIssuerURL  string   `yaml:"oidc_issuer_url" json:"oidc_issuer_url,omitempty"`
		Permissions    []string `yaml:"permissions" json:"permissions,omitempty"`
		Scopes         []string `yaml:"scopes" json:"scopes,omitempty"`
		AuthURL        string   `yaml:"auth_url" json:"auth_url,omitempty"`
		TokenURL       string   `yaml:"token_url" json:"token_url,omitempty"`
	} `yaml:"auth" json:"auth"`

	UI struct {
		Icon             string `yaml:"icon" json:"icon"`
		DescriptionShort string `yaml:"description_short" json:"description_short"`
		Category         string `yaml:"category" json:"category"`
	} `yaml:"ui" json:"ui"`

	BackgroundTasks bool     `yaml:"background_tasks" json:"background_tasks"`
	SystemEvents    []string `yaml:"system_events" json:"system_events"`
}

// Manifests holds loaded plugin manifests (set by Load).
var Manifests []*Manifest

// Load scans pluginsDir for plugin subdirectories, reads each manifest.yaml, and populates Manifests.
// Returns the loaded manifests and nil error, or partial list and error if some failed.
func Load(pluginsDir string, logger *zap.Logger) ([]*Manifest, error) {
	if pluginsDir == "" {
		pluginsDir = "plugins"
	}
	absDir, err := filepath.Abs(pluginsDir)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(absDir)
	if err != nil {
		if os.IsNotExist(err) {
			logger.Warn("plugins directory does not exist", zap.String("dir", absDir))
			Manifests = nil
			return nil, nil
		}
		return nil, err
	}
	var out []*Manifest
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		manifestPath := filepath.Join(absDir, name, "manifest.yaml")
		data, err := os.ReadFile(manifestPath)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			logger.Warn("failed to read plugin manifest", zap.String("plugin", name), zap.Error(err))
			continue
		}
		var m Manifest
		if err := yaml.Unmarshal(data, &m); err != nil {
			logger.Warn("failed to parse plugin manifest", zap.String("plugin", name), zap.Error(err))
			continue
		}
		if m.Name == "" {
			m.Name = name
		}
		out = append(out, &m)
		logger.Debug("loaded plugin manifest", zap.String("name", m.Name))
	}
	Manifests = out
	return out, nil
}
