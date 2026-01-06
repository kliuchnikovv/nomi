package config

import (
	"log"
	"os"

	"github.com/a8m/envsubst"
	"gopkg.in/yaml.v3"
)

type Config struct {
	Server struct {
		Port int `yaml:"port"`
	} `yaml:"server"`
	Database struct {
		Host     string `yaml:"host"`
		Port     int    `yaml:"port"`
		User     string `yaml:"user"`
		Password string `yaml:"password"`
		DBName   string `yaml:"name"`
		SSLMode  string `yaml:"sslmode"`
	} `yaml:"db"`
	Token struct {
		JWTSecret string `yaml:"jwt_secret"`
	} `yaml:"token"`
	OAuth2 struct {
		CallbackBase string                      `yaml:"callback_base"`
		Providers    map[string]OAuthProviderCfg `yaml:"providers"`
	} `yaml:"oauth2"`
	Plugins map[string]struct {
		Enabled bool   `yaml:"enabled"`
		State   string `yaml:"state"` // e.g. "active", "beta", "disabled"
	} `yaml:"plugins"`
	LLM struct {
		BaseURL string `yaml:"base_url"` // URL for the python backend
	} `yaml:"llm"`
	Webhooks struct {
		GitHubSecret string `yaml:"github_secret"`
	} `yaml:"webhooks"`
}

type OAuthProviderCfg struct {
	ClientID     string   `yaml:"client_id"`
	ClientSecret string   `yaml:"client_secret"`
	RedirectURL  string   `yaml:"redirect_url"`
	Scopes       []string `yaml:"scopes"`
	IssuerURL    string   `yaml:"issuer_url,omitempty"`
}

func Load() (*Config, error) {
	// Read the config file
	data, err := os.ReadFile("config/config.yaml")
	if err != nil {
		// Fallback to default path if not found (e.g. for tests)
		data, err = os.ReadFile("../../config/config.yaml")
		if err != nil {
			log.Printf("Failed to read config file: %v", err)
			return nil, err
		}
	}

	// Expand environment variables
	expandedData, err := envsubst.Bytes(data)
	if err != nil {
		log.Printf("Failed to expand env vars: %v", err)
		return nil, err
	}

	var cfg Config
	if err := yaml.Unmarshal(expandedData, &cfg); err != nil {
		log.Printf("Failed to unmarshal config: %v", err)
		return nil, err
	}

	return &cfg, nil
}
