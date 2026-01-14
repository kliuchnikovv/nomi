package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// setupTestDB creates an in-memory SQLite DB and migrates schema
func setupTestDB(t *testing.T) *storage.Storage {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	assert.NoError(t, err)

	// Auto migrate project struct and User struct
	err = db.AutoMigrate(&storage.Project{}, &storage.User{})
	assert.NoError(t, err)

	return &storage.Storage{DB: db}
}

func TestListProjects(t *testing.T) {
	// Setup
	store := setupTestDB(t)
	logger := zap.NewNop()
	cfg := &config.Config{}
	cfg.LLM.BaseURL = "http://mock-llm"

	// We pass nil for hubInstance as ListProjects does not use it.
	h := NewProjectHandler(store, logger, cfg, nil)

	// Create a test user
	userID := uuid.New()
	user := &storage.User{
		ID:    userID,
		Email: "test@example.com",
	}
	res := store.DB.Create(user)
	assert.NoError(t, res.Error)

	// Create key projects
	p1ID := uuid.New()
	p2ID := uuid.New()
	
	p1 := &storage.Project{
		ID:          p1ID,
		UserID:      userID,
		Name:        "Project Alpha",
		Description: "Values test",
		Status:      storage.ProjectStatusReady,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	store.DB.Create(p1)

	p2 := &storage.Project{
		ID:          p2ID,
		UserID:      userID,
		Name:        "Project Beta",
		Status:      storage.ProjectStatusAnalyzing,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	store.DB.Create(p2)

	// Setup Gin
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// Mock Auth Middleware by setting context variable
	r.Use(func(c *gin.Context) {
		c.Set("userID", userID)
	})
	r.GET("/projects", h.ListProjects)

	// Request
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/projects", nil)
	r.ServeHTTP(w, req)

	// Assert
	assert.Equal(t, http.StatusOK, w.Code)

	var projects []storage.Project
	err := json.Unmarshal(w.Body.Bytes(), &projects)
	assert.NoError(t, err)

	// GORM might return in any order depending on specific SQL/Driver implementation
	// But usually insertion order for sqlite.
	assert.Len(t, projects, 2)
	
	// Helper to find project by name
	findProj := func(name string) *storage.Project {
		for _, p := range projects {
			if p.Name == name {
				return &p
			}
		}
		return nil
	}

	projAlpha := findProj("Project Alpha")
	assert.NotNil(t, projAlpha)
	assert.Equal(t, "Values test", projAlpha.Description)
	
	projBeta := findProj("Project Beta")
	assert.NotNil(t, projBeta)
	assert.Equal(t, storage.ProjectStatusAnalyzing, projBeta.Status)
}
