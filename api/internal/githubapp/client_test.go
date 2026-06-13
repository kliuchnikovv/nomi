package githubapp

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// testKeyPEM generates a throwaway RSA key and returns it PKCS#1 PEM-encoded.
func testKeyPEM(t *testing.T) (string, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	})
	return string(pemBytes), key
}

func TestNewClientRejectsBadInput(t *testing.T) {
	if _, err := NewClient(0, "whatever"); err == nil {
		t.Error("expected error for zero app id")
	}
	if _, err := NewClient(123, "not a pem"); err == nil {
		t.Error("expected error for invalid private key")
	}
}

func TestNewClientAcceptsBase64Key(t *testing.T) {
	pemStr, _ := testKeyPEM(t)
	b64 := base64.StdEncoding.EncodeToString([]byte(pemStr))
	if _, err := NewClient(789, b64); err != nil {
		t.Fatalf("NewClient with base64 key: %v", err)
	}
}

func TestAppJWT(t *testing.T) {
	pemStr, key := testKeyPEM(t)
	c, err := NewClient(456, pemStr)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	tokenStr, err := c.appJWT()
	if err != nil {
		t.Fatalf("appJWT: %v", err)
	}

	// The JWT must verify with the matching public key and carry correct claims.
	claims := &jwt.RegisteredClaims{}
	parsed, err := jwt.ParseWithClaims(tokenStr, claims, func(tok *jwt.Token) (any, error) {
		if _, ok := tok.Method.(*jwt.SigningMethodRSA); !ok {
			t.Fatalf("unexpected signing method: %v", tok.Header["alg"])
		}
		return &key.PublicKey, nil
	})
	if err != nil {
		t.Fatalf("parse/verify JWT: %v", err)
	}
	if !parsed.Valid {
		t.Fatal("JWT not valid")
	}
	if claims.Issuer != "456" {
		t.Errorf("issuer = %q, want %q", claims.Issuer, "456")
	}
	if claims.IssuedAt == nil || claims.IssuedAt.After(time.Now()) {
		t.Error("iat should be backdated, not in the future")
	}
	if claims.ExpiresAt == nil {
		t.Fatal("exp missing")
	}
	lifetime := claims.ExpiresAt.Sub(claims.IssuedAt.Time)
	if lifetime > 11*time.Minute {
		t.Errorf("lifetime %v exceeds GitHub's 10m cap", lifetime)
	}
}

func TestDeleteInstallation(t *testing.T) {
	pemStr, _ := testKeyPEM(t)

	tests := []struct {
		name       string
		status     int
		wantErr    bool
		wantCalled bool
	}{
		{name: "success 204", status: http.StatusNoContent, wantErr: false, wantCalled: true},
		{name: "already gone 404", status: http.StatusNotFound, wantErr: false, wantCalled: true},
		{name: "server error", status: http.StatusInternalServerError, wantErr: true, wantCalled: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var called bool
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				if r.Method != http.MethodDelete {
					t.Errorf("method = %q, want DELETE", r.Method)
				}
				if r.URL.Path != "/app/installations/42" {
					t.Errorf("path = %q, want /app/installations/42", r.URL.Path)
				}
				if auth := r.Header.Get("Authorization"); !strings.HasPrefix(auth, "Bearer ") {
					t.Errorf("missing Bearer auth header, got %q", auth)
				}
				w.WriteHeader(tt.status)
			}))
			defer srv.Close()

			c, err := NewClient(456, pemStr)
			if err != nil {
				t.Fatalf("NewClient: %v", err)
			}
			c.baseURL = srv.URL
			// Seed the cache so we can assert it's evicted on success.
			c.cache[42] = cachedToken{token: "stale", expiresAt: time.Now().Add(time.Hour)}

			err = c.DeleteInstallation(context.Background(), 42)
			if called != tt.wantCalled {
				t.Errorf("server called = %v, want %v", called, tt.wantCalled)
			}
			if tt.wantErr && err == nil {
				t.Fatal("expected error, got nil")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !tt.wantErr {
				if _, ok := c.cache[42]; ok {
					t.Error("cached token should be evicted after delete")
				}
			}
		})
	}
}
