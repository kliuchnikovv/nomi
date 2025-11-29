package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// IntegrationsHandler exposes CRUD for user integrations (OAuth accounts, etc).
type IntegrationsHandler struct {
	storage *storage.Storage
}

func NewIntegrationsHandler(storage *storage.Storage) *IntegrationsHandler {
	return &IntegrationsHandler{storage: storage}
}

type IntegrationDTO struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Provider  string    `json:"provider"`
	Params    string    `json:"params"`
	Enabled   bool      `json:"enabled"`
	CreatedAt int64     `json:"created_at"`
	UpdatedAt int64     `json:"updated_at"`
}

// ListIntegrations returns all integrations for the authenticated user.
func (h *IntegrationsHandler) ListIntegrations(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	integrations, err := h.storage.GetIntegrations(ctx, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load integrations"})
		return
	}

	resp := make([]IntegrationDTO, 0, len(integrations))
	for _, it := range integrations {
		resp = append(resp, IntegrationDTO{
			ID:        it.ID,
			Name:      it.Name,
			Provider:  it.Provider,
			Params:    it.Params,
			Enabled:   it.Enabled,
			CreatedAt: it.CreatedAt.Unix(),
			UpdatedAt: it.UpdatedAt.Unix(),
		})
	}

	c.JSON(http.StatusOK, gin.H{"items": resp})
}

// UpdateIntegration updates mutable fields like name and enabled flag.
func (h *IntegrationsHandler) UpdateIntegration(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	integID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid integration id"})
		return
	}

	existing, err := h.storage.GetIntegration(ctx, user.ID, integID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "integration not found"})
		return
	}

	var payload struct {
		Name    *string `json:"name"`
		Enabled *bool   `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	if payload.Name != nil {
		existing.Name = *payload.Name
	}
	if payload.Enabled != nil {
		existing.Enabled = *payload.Enabled
	}

	updated, err := h.storage.UpdateIntegration(ctx, user.ID, existing)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update integration"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":       updated.ID,
		"name":     updated.Name,
		"provider": updated.Provider,
		"params":   updated.Params,
		"enabled":  updated.Enabled,
	})
}

// DeleteIntegration removes an integration for the user.
func (h *IntegrationsHandler) DeleteIntegration(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	integID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid integration id"})
		return
	}

	if err := h.storage.DeleteIntegration(ctx, user.ID, integID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete integration"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}
