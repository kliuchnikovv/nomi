package handlers

import (
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

type UploadHandler struct {
	storage *storage.Storage
}

func NewUploadHandler(store *storage.Storage) *UploadHandler {
	return &UploadHandler{storage: store}
}

func (h *UploadHandler) UploadFile(c *gin.Context) {
	// Parse multipart form
	// Max upload size: 10MB
	if err := c.Request.ParseMultipartForm(10 << 20); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large"})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	defer file.Close()

	// Get user ID from context
	user, err := userFromCtx(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	// Read file content
	content, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}

	// Create attachment record
	attachment := storage.Attachment{
		UserID:    user.ID,
		FileName:  header.Filename,
		FileType:  header.Header.Get("Content-Type"),
		Size:      header.Size,
		Content:   content,
		CreatedAt: time.Now(),
	}

	if err := h.storage.CreateAttachment(c.Request.Context(), &attachment); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save attachment"})
		return
	}

	// Return metadata
	c.JSON(http.StatusOK, gin.H{
		"id":         attachment.ID,
		"file_name":  attachment.FileName,
		"file_type":  attachment.FileType,
		"size":       attachment.Size,
		"created_at": attachment.CreatedAt,
	})
}

func (h *UploadHandler) GetAttachment(c *gin.Context) {
	var ctx = c.Request.Context()

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid attachment ID"})
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	attachment, err := h.storage.GetAttachment(ctx, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Attachment not found"})
		return
	}

	// Simple ownership check
	if attachment.UserID != user.ID {
		// Ideally also check if user has access to the message/chat this attachment belongs to
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	c.Header("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", attachment.FileName))
	c.Data(http.StatusOK, attachment.FileType, attachment.Content)
}
