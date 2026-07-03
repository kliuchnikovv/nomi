package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
)

func TestDiscoverModels(t *testing.T) {
	// Mock server for successful discovery
	successServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
		assert.Equal(t, "/v1/models", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"data": [{"id": "model-a"}, {"id": "model-b"}]}`))
	}))
	defer successServer.Close()

	// Test successful discovery
	models, err := DiscoverModels("test-key", successServer.URL, "test-provider")
	assert.NoError(t, err)
	assert.Len(t, models, 2)
	assert.Equal(t, "model-a", models[0].ID)
	assert.Equal(t, "test-provider", models[0].Provider)
	assert.Equal(t, "model-b", models[1].ID)
	assert.Equal(t, "test-provider", models[1].Provider)

	// Test invalid endpoint
	models, err = DiscoverModels("test-key", "", "test-provider")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "endpoint URL cannot be empty")

	// Mock server for unauthorized response (401)
	unauthorizedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error": "Invalid API key"}`))
	}))
	defer unauthorizedServer.Close()

	// Test unauthorized
	models, err = DiscoverModels("bad-key", unauthorizedServer.URL, "test-provider")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "API request failed with status 401")

	// Mock server for internal server error (500)
	errorServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error": "Internal server error"}`))
	}))
	defer errorServer.Close()

	// Test server error
	models, err = DiscoverModels("test-key", errorServer.URL, "test-provider")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "API request failed with status 500")

	// Test invalid JSON response
	invalidJsonServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`this is not json`))
	}))
	defer invalidJsonServer.Close()

	models, err = DiscoverModels("test-key", invalidJsonServer.URL, "test-provider")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to decode OpenAI compatible response")
}

func TestDiscoverModelsHandler(t *testing.T) {
	logger, _ := zap.NewDevelopment()

	// Mock server for successful discovery
	successServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"data": [{"id": "model-x"}]}`))
	}))
	defer successServer.Close()

	// Test successful discovery
	reqBody := []byte(fmt.Sprintf(`{"api_key": "handler-key", "endpoint": "%s", "provider": "handler-provider"}`, successServer.URL))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/models/discover", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	h := NewModelsHandler("", logger) // db is not used in this handler, pass empty string for apiKey
	h.discoverModelsFunc = DiscoverModels // Use actual DiscoverModels for handler test
	h.DiscoverModelsHandler(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var models []Model
	err := json.NewDecoder(rr.Body).Decode(&models)
	assert.NoError(t, err)
	assert.Len(t, models, 1)
	assert.Equal(t, "model-x", models[0].ID)
	assert.Equal(t, "handler-provider", models[0].Provider)

	// Test invalid request body
	req = httptest.NewRequest(http.MethodPost, "/api/v1/models/discover", bytes.NewBuffer([]byte(`invalid json`)))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()

	h.DiscoverModelsHandler(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assert.Contains(t, rr.Body.String(), "Invalid request body")

	// Mock server for unauthorized response (401)
	unauthorizedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error": "Invalid API key"}`))
	}))
	defer unauthorizedServer.Close()

	// Test unauthorized error from handler
	reqBody = []byte(fmt.Sprintf(`{"api_key": "bad-handler-key", "endpoint": "%s", "provider": "handler-provider"}`, unauthorizedServer.URL))
	req = httptest.NewRequest(http.MethodPost, "/api/v1/models/discover", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()

	h.DiscoverModelsHandler(rr, req)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
	assert.Contains(t, rr.Body.String(), "Unauthorized: Invalid API Key")

	// Test invalid endpoint from handler
	reqBody = []byte(`{"api_key": "handler-key", "endpoint": "", "provider": "handler-provider"}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/models/discover", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()

	h.DiscoverModelsHandler(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assert.Contains(t, rr.Body.String(), "endpoint URL cannot be empty")

	// Test server error from handler (500)
	errorServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error": "Internal server error"}`))
	}))
	defer errorServer.Close()

	reqBody = []byte(fmt.Sprintf(`{"api_key": "handler-key", "endpoint": "%s", "provider": "handler-provider"}`, errorServer.URL))
	req = httptest.NewRequest(http.MethodPost, "/api/v1/models/discover", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()

	h.DiscoverModelsHandler(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assert.Contains(t, rr.Body.String(), "Failed to discover models")

	// Test invalid JSON response from handler
	invalidJsonServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`this is not json`))
	}))
	defer invalidJsonServer.Close()

	reqBody = []byte(fmt.Sprintf(`{"api_key": "test-key", "endpoint": "%s", "provider": "test-provider"}`, invalidJsonServer.URL))
	req = httptest.NewRequest(http.MethodPost, "/api/v1/models/discover", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()

	h.DiscoverModelsHandler(rr, req)
	assert.Equal(t, http.StatusBadGateway, rr.Code)
	assert.Contains(t, rr.Body.String(), "Invalid API response from endpoint")

}