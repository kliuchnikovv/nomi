package handlers

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/llm"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// EmailAnalysisHandler handles email analysis requests.
type EmailAnalysisHandler struct {
	storage *storage.Storage
	llm     *llm.Service
}

// NewEmailAnalysisHandler creates a new instance of EmailAnalysisHandler.
func NewEmailAnalysisHandler(storage *storage.Storage, llmService *llm.Service) *EmailAnalysisHandler {
	return &EmailAnalysisHandler{storage: storage, llm: llmService}
}

// AnalyzeEmail proxies the email analysis request to the LLM backend.
func (h *EmailAnalysisHandler) AnalyzeEmail(c *gin.Context) {
	ctx := c.Request.Context()

	// Parse request body
	var req llm.EmailAnalysisRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid request: %v", err)})
		return
	}

	// Validate required fields
	if req.EmailID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email_id is required"})
		return
	}
	if req.Body == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "body is required"})
		return
	}

	result, err := h.llm.AnalyzeEmail(ctx, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to analyze email: %v", err)})
		return
	}

	c.JSON(http.StatusOK, result)
}
