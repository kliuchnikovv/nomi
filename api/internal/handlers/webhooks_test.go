package handlers

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
)

func TestWebhooksHandler_HandleGitHub(t *testing.T) {
	gin.SetMode(gin.TestMode)
	logger := zap.NewNop()
	// Mock DB is not easily mocked with GORM in simple tests without interface,
	// but we can test logic up to DB insertion or mock the handler dependencies if we refactor.
	// For now, since we integrated directly with storage.Storage struct which uses concrete GORM DB,
	// we will primarily test validation logic and early returns.
	// To test DB insertion, we'd need a real DB or sqlmock.
	// Given the constraints, I will test the validation logic by mocking the request.

	// Since we can't easily mock *storage.Storage without setting up a real DB connection in this environment,
	// we will assume DB operations would fail if we reach that point, or we can use a mock/sqlite if possible.
	// However, for signature validation and filtering, we don't hit the DB yet.

	secret := "test-secret"
	handler := &WebhooksHandler{
		store:  &storage.Storage{}, // Empty storage, will panic if accessed, so we only test up to DB call or error
		logger: logger,
		secret: secret,
	}

	t.Run("Invalid Signature", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)

		body := []byte(`{}`)
		c.Request, _ = http.NewRequest("POST", "/api/webhooks/github", bytes.NewBuffer(body))
		c.Request.Header.Set("X-Hub-Signature-256", "sha256=invalid")
		c.Request.Header.Set("X-GitHub-Event", "pull_request")

		handler.HandleGitHub(c)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("Valid Signature, Wrong Event", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)

		body := []byte(`{}`)
		signature := computeSignature(body, secret)
		c.Request, _ = http.NewRequest("POST", "/api/webhooks/github", bytes.NewBuffer(body))
		c.Request.Header.Set("X-Hub-Signature-256", signature)
		c.Request.Header.Set("X-GitHub-Event", "push")

		handler.HandleGitHub(c)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), "not a pull_request event")
	})

	t.Run("Valid Signature, Wrong Action", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)

		payload := githubPayload{
			Action: "closed",
		}
		body, _ := json.Marshal(payload)
		signature := computeSignature(body, secret)

		c.Request, _ = http.NewRequest("POST", "/api/webhooks/github", bytes.NewBuffer(body))
		c.Request.Header.Set("X-Hub-Signature-256", signature)
		c.Request.Header.Set("X-GitHub-Event", "pull_request")

		handler.HandleGitHub(c)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), "action not supported")
	})

	t.Run("Valid Signature, Wrong Sender", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)

		payload := githubPayload{
			Action: "opened",
			Sender: githubUser{Login: "random-user"},
		}
		body, _ := json.Marshal(payload)
		signature := computeSignature(body, secret)

		c.Request, _ = http.NewRequest("POST", "/api/webhooks/github", bytes.NewBuffer(body))
		c.Request.Header.Set("X-Hub-Signature-256", signature)
		c.Request.Header.Set("X-GitHub-Event", "pull_request")

		handler.HandleGitHub(c)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), "sender validation failed")
	})

	// Note: We cannot test the success case (DB insertion) easily without a running DB.
	// But we have covered all the filtering logic.
}

func computeSignature(body []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}
