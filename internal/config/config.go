package config

import (
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
		DBName   string `yaml:"dbname"`
	} `yaml:"database"`
	OAuth2 struct {
		Providers map[string]struct {
			ClientID     string   `yaml:"client_id"`
			ClientSecret string   `yaml:"client_secret"`
			RedirectURL  string   `yaml:"redirect_url"`
			IssuerURL    string   `yaml:"issuer_url"`
			Scopes       []string `yaml:"scopes"`
		} `yaml:"providers"`
	} `yaml:"oauth2"`
	Token struct {
		// Refresh token if it will expire in less than this many minutes
		RefreshBeforeMinutes int    `yaml:"refresh_before_minutes"`
		JWTSecret            string `yaml:"jwt_secret"`
	} `yaml:"token"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	// Заменяем переменные окружения
	expanded, err := envsubst.Bytes(data)
	if err != nil {
		return nil, err
	}

	var cfg Config
	if err := yaml.Unmarshal(expanded, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}
