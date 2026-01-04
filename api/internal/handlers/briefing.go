package handlers

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/llm"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// BriefingHandler handles briefing generation requests.
type BriefingHandler struct {
	storage *storage.Storage
	llm     *llm.Service
}

// NewBriefingHandler creates a new instances of BriefingHandler.
func NewBriefingHandler(storage *storage.Storage, llmService *llm.Service) *BriefingHandler {
	return &BriefingHandler{storage: storage, llm: llmService}
}

// GetBriefing proxies the briefing request to the LLM backend.
func (h *BriefingHandler) GetBriefing(c *gin.Context) {
	ctx := c.Request.Context()

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	// Parse request body to get context (optional)
	var req struct {
		Context map[string]interface{} `json:"context"`
	}
	// We use ShouldBindJSON to allow empty body (though frontend usually sends it)
	if err := c.ShouldBindJSON(&req); err != nil {
		// Log specific error if needed, but for now we proceed with empty context if binding fails
		// because body might be empty for legacy reasons.
		// However, if body IS present but invalid JSON, we might want to return error.
		// For now, assume empty context on error.
	}

	briefing, err := h.llm.GetBriefing(ctx, user.ID.String(), req.Context)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to get briefing: %v", err)})
		return
	}

	c.JSON(http.StatusOK, briefing)
}
