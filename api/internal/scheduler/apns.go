package scheduler

import (
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"

	"github.com/sideshow/apns2"
	"github.com/sideshow/apns2/token"
)

type APNSConfig struct {
	KeyPath  string
	KeyID    string
	TeamID   string
	BundleID string
	Sandbox  bool
}

func APNSConfigFromEnv() APNSConfig {
	return APNSConfig{
		KeyPath:  os.Getenv("APNS_KEY_PATH"),
		KeyID:    os.Getenv("APNS_KEY_ID"),
		TeamID:   os.Getenv("APNS_TEAM_ID"),
		BundleID: os.Getenv("APNS_BUNDLE_ID"),
		Sandbox:  os.Getenv("APNS_SANDBOX") == "true",
	}
}

func (c APNSConfig) IsConfigured() bool {
	return c.KeyPath != "" && c.KeyID != "" && c.TeamID != "" && c.BundleID != ""
}

func newAPNSClient(cfg APNSConfig) (*apns2.Client, error) {
	keyData, err := os.ReadFile(cfg.KeyPath)
	if err != nil {
		return nil, fmt.Errorf("read apns key: %w", err)
	}

	block, _ := pem.Decode(keyData)
	if block == nil {
		return nil, fmt.Errorf("failed to decode pem block")
	}

	key, err := x509.ParseECPrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse apns key: %w", err)
	}

	authToken := &token.Token{
		AuthKey: key,
		KeyID:   cfg.KeyID,
		TeamID:  cfg.TeamID,
	}

	client := apns2.NewTokenClient(authToken)
	if cfg.Sandbox {
		client = client.Development()
	} else {
		client = client.Production()
	}
	return client, nil
}
