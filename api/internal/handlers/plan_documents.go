package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/models"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// PlanDocumentsHandler handles REST operations for daily plan documents.
type PlanDocumentsHandler struct {
	store  *storage.Storage
	logger *zap.Logger
}

// NewPlanDocumentsHandler creates a new PlanDocumentsHandler.
func NewPlanDocumentsHandler(store *storage.Storage, logger *zap.Logger) *PlanDocumentsHandler {
	return &PlanDocumentsHandler{
		store:  store,
		logger: logger,
	}
}

// storageDocToModel converts a storage.PlanDocument to the API response model.
func storageDocToModel(doc *storage.PlanDocument) *models.PlanDocument {
	return &models.PlanDocument{
		ID:        doc.ID.String(),
		UserID:    doc.UserID.String(),
		Date:      doc.Date,
		Items:     []byte(doc.Items),
		CreatedAt: doc.CreatedAt,
		UpdatedAt: doc.UpdatedAt,
	}
}

// GetPlanDocument returns the plan document for the authenticated user on a given date.
// GET /api/plan-documents?date=YYYY-MM-DD
func (h *PlanDocumentsHandler) GetPlanDocument(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)

	date := c.Query("date")
	if date == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "date query parameter is required (YYYY-MM-DD)"})
		return
	}

	doc, err := h.store.GetPlanDocument(c.Request.Context(), userID, date)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "plan document not found"})
			return
		}
		h.logger.Error("failed to get plan document",
			zap.String("user_id", userID.String()),
			zap.String("date", date),
			zap.Error(err),
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get plan document"})
		return
	}

	c.JSON(http.StatusOK, storageDocToModel(doc))
}

// createPlanDocumentRequest is the request body for creating a plan document.
type createPlanDocumentRequest struct {
	Date  string          `json:"date" binding:"required"`
	Items datatypes.JSON  `json:"items"`
}

// CreatePlanDocument creates a new plan document for the authenticated user.
// POST /api/plan-documents
func (h *PlanDocumentsHandler) CreatePlanDocument(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)

	var req createPlanDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	items := req.Items
	if items == nil {
		items = datatypes.JSON([]byte("[]"))
	}

	doc, err := h.store.CreatePlanDocument(c.Request.Context(), &storage.PlanDocument{
		UserID: userID,
		Date:   req.Date,
		Items:  items,
	})
	if err != nil {
		h.logger.Error("failed to create plan document",
			zap.String("user_id", userID.String()),
			zap.String("date", req.Date),
			zap.Error(err),
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create plan document"})
		return
	}

	c.JSON(http.StatusCreated, storageDocToModel(doc))
}

// patchPlanDocumentRequest is the request body for patching a plan document.
// Rather than implementing individual patch ops, we accept a full items replacement.
type patchPlanDocumentRequest struct {
	Items datatypes.JSON `json:"items" binding:"required"`
}

// PatchPlanDocument replaces the items of a plan document.
// PATCH /api/plan-documents/:id
func (h *PlanDocumentsHandler) PatchPlanDocument(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid plan document id"})
		return
	}

	var req patchPlanDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	doc, err := h.store.UpdatePlanDocumentItems(c.Request.Context(), id, userID, req.Items)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "plan document not found"})
			return
		}
		h.logger.Error("failed to patch plan document",
			zap.String("user_id", userID.String()),
			zap.String("id", idStr),
			zap.Error(err),
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to patch plan document"})
		return
	}

	c.JSON(http.StatusOK, storageDocToModel(doc))
}
