package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

type ListHandler struct {
	store      *storage.Storage
	logger     *zap.Logger
	llmBaseURL string
}

func NewListHandler(store *storage.Storage, logger *zap.Logger, cfg *config.Config) *ListHandler {
	baseURL := cfg.LLM.BaseURL
	if baseURL == "" {
		baseURL = os.Getenv("LLM_BASE_URL")
	}
	if baseURL == "" {
		baseURL = "http://localhost:7777"
	}
	return &ListHandler{
		store:      store,
		logger:     logger.With(zap.String("component", "list_handler")),
		llmBaseURL: baseURL,
	}
}

// indexListItemInRAG calls Python to index one list item in RAG (async, fire-and-forget)
func (h *ListHandler) indexListItemInRAG(listID string, userID uuid.UUID, itemID uuid.UUID, title, content, url string) {
	payload := map[string]interface{}{
		"content": content,
		"title":   title,
		"url":     url,
		"user_id": userID.String(),
		"item_id": itemID.String(), // Send item_id for deduplication
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		h.logger.Error("failed to marshal index list item request", zap.Error(err))
		return
	}
	req, err := http.NewRequest(http.MethodPost, h.llmBaseURL+"/api/lists/"+listID+"/items/index", bytes.NewReader(payloadBytes))
	if err != nil {
		h.logger.Error("failed to create index list item request", zap.Error(err))
		return
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		h.logger.Error("failed to call Python index list item", zap.Error(err))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		h.logger.Warn("Python index list item returned non-OK", zap.Int("status", resp.StatusCode), zap.String("list_id", listID))
	}
}

// deleteListKnowledgeInRAG calls Python to delete list RAG space (async, fire-and-forget)
func (h *ListHandler) deleteListKnowledgeInRAG(listID string, userID uuid.UUID) {
	payload := map[string]interface{}{"user_id": userID.String()}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		h.logger.Error("failed to marshal delete list knowledge request", zap.Error(err))
		return
	}
	req, err := http.NewRequest(http.MethodDelete, h.llmBaseURL+"/api/lists/"+listID+"/knowledge", bytes.NewReader(payloadBytes))
	if err != nil {
		h.logger.Error("failed to create delete list knowledge request", zap.Error(err))
		return
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		h.logger.Error("failed to call Python delete list knowledge", zap.Error(err))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		h.logger.Warn("Python delete list knowledge returned non-OK", zap.Int("status", resp.StatusCode), zap.String("list_id", listID))
	}
}

// --- List CRUD ---

func (h *ListHandler) CreateList(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	list := &storage.List{
		UserID:      userID,
		Name:        req.Name,
		Description: req.Description,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if err := h.store.CreateList(c.Request.Context(), list); err != nil {
		h.logger.Error("failed to create list", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create list"})
		return
	}
	c.JSON(http.StatusCreated, list)
}

func (h *ListHandler) ListLists(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	lists, err := h.store.GetLists(c.Request.Context(), userID)
	if err != nil {
		h.logger.Error("failed to list lists", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list lists"})
		return
	}
	c.JSON(http.StatusOK, lists)
}

func (h *ListHandler) GetList(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid list ID"})
		return
	}
	list, err := h.store.GetList(c.Request.Context(), id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "List not found"})
			return
		}
		h.logger.Error("failed to get list", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get list"})
		return
	}
	if list.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}
	c.JSON(http.StatusOK, list)
}

func (h *ListHandler) UpdateList(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid list ID"})
		return
	}
	list, err := h.store.GetList(c.Request.Context(), id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "List not found"})
			return
		}
		h.logger.Error("failed to get list", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get list"})
		return
	}
	if list.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}
	var req struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	if req.Name != nil {
		list.Name = *req.Name
	}
	if req.Description != nil {
		list.Description = *req.Description
	}
	list.UpdatedAt = time.Now().UTC()
	if err := h.store.UpdateList(c.Request.Context(), list); err != nil {
		h.logger.Error("failed to update list", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update list"})
		return
	}
	c.JSON(http.StatusOK, list)
}

func (h *ListHandler) DeleteList(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid list ID"})
		return
	}
	list, err := h.store.GetList(c.Request.Context(), id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "List not found"})
			return
		}
		h.logger.Error("failed to get list", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get list"})
		return
	}
	if list.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}
	if err := h.store.DeleteListItemsByListID(c.Request.Context(), id); err != nil {
		h.logger.Error("failed to delete list items", zap.Error(err))
	}
	if err := h.store.DeleteList(c.Request.Context(), id); err != nil {
		h.logger.Error("failed to delete list", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete list"})
		return
	}
	go h.deleteListKnowledgeInRAG(id.String(), userID)
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

// --- List items CRUD ---

func (h *ListHandler) CreateListItem(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	listIDStr := c.Param("id")
	listID, err := uuid.Parse(listIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid list ID"})
		return
	}
	list, err := h.store.GetList(c.Request.Context(), listID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "List not found"})
			return
		}
		h.logger.Error("failed to get list", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get list"})
		return
	}
	if list.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}
	var req struct {
		Type    string `json:"type"` // fact, link, document
		Title   string `json:"title"`
		Content string `json:"content"`
		URL     string `json:"url"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	itemType := storage.ListItemType(req.Type)
	if itemType != storage.ListItemTypeFact && itemType != storage.ListItemTypeLink && itemType != storage.ListItemTypeDocument {
		c.JSON(http.StatusBadRequest, gin.H{"error": "type must be fact, link, or document"})
		return
	}
	if req.Content == "" && req.URL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "content or url required"})
		return
	}
	if itemType == storage.ListItemTypeLink && req.URL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "url required for link type"})
		return
	}
	item := &storage.ListItem{
		ListID:    listID,
		Type:      itemType,
		Title:     req.Title,
		Content:   req.Content,
		URL:       req.URL,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	if err := h.store.CreateListItem(c.Request.Context(), item); err != nil {
		h.logger.Error("failed to create list item", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create list item"})
		return
	}
	// Index in RAG: combined text for link = title + url + content; for fact/document = title + content
	contentForRAG := item.Title
	if item.URL != "" {
		if contentForRAG != "" {
			contentForRAG += "\n"
		}
		contentForRAG += item.URL
	}
	if item.Content != "" {
		if contentForRAG != "" {
			contentForRAG += "\n"
		}
		contentForRAG += item.Content
	}
	if contentForRAG != "" {
		go h.indexListItemInRAG(listID.String(), userID, item.ID, item.Title, contentForRAG, item.URL)
	}
	c.JSON(http.StatusCreated, item)
}

func (h *ListHandler) ListListItems(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	listIDStr := c.Param("id")
	listID, err := uuid.Parse(listIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid list ID"})
		return
	}
	list, err := h.store.GetList(c.Request.Context(), listID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "List not found"})
			return
		}
		h.logger.Error("failed to get list", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get list"})
		return
	}
	if list.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}
	items, err := h.store.GetListItems(c.Request.Context(), listID)
	if err != nil {
		h.logger.Error("failed to list items", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list items"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h *ListHandler) GetListItem(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	itemIDStr := c.Param("itemId")
	itemID, err := uuid.Parse(itemIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid item ID"})
		return
	}
	item, err := h.store.GetListItem(c.Request.Context(), itemID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Item not found"})
			return
		}
		h.logger.Error("failed to get list item", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get list item"})
		return
	}
	list, err := h.store.GetList(c.Request.Context(), item.ListID)
	if err != nil || list.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *ListHandler) UpdateListItem(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	itemIDStr := c.Param("itemId")
	itemID, err := uuid.Parse(itemIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid item ID"})
		return
	}
	item, err := h.store.GetListItem(c.Request.Context(), itemID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Item not found"})
			return
		}
		h.logger.Error("failed to get list item", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get list item"})
		return
	}
	list, err := h.store.GetList(c.Request.Context(), item.ListID)
	if err != nil || list.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}
	var req struct {
		Type    *string `json:"type"`
		Title   *string `json:"title"`
		Content *string `json:"content"`
		URL     *string `json:"url"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	if req.Type != nil {
		t := storage.ListItemType(*req.Type)
		if t != storage.ListItemTypeFact && t != storage.ListItemTypeLink && t != storage.ListItemTypeDocument {
			c.JSON(http.StatusBadRequest, gin.H{"error": "type must be fact, link, or document"})
			return
		}
		item.Type = t
	}
	if req.Title != nil {
		item.Title = *req.Title
	}
	if req.Content != nil {
		item.Content = *req.Content
	}
	if req.URL != nil {
		item.URL = *req.URL
	}
	item.UpdatedAt = time.Now().UTC()
	if err := h.store.UpdateListItem(c.Request.Context(), item); err != nil {
		h.logger.Error("failed to update list item", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update list item"})
		return
	}
	contentForRAG := item.Title
	if item.URL != "" {
		if contentForRAG != "" {
			contentForRAG += "\n"
		}
		contentForRAG += item.URL
	}
	if item.Content != "" {
		if contentForRAG != "" {
			contentForRAG += "\n"
		}
		contentForRAG += item.Content
	}
	if contentForRAG != "" {
		go h.indexListItemInRAG(item.ListID.String(), userID, item.ID, item.Title, contentForRAG, item.URL)
	}
	c.JSON(http.StatusOK, item)
}

func (h *ListHandler) DeleteListItem(c *gin.Context) {
	userID := c.MustGet("userID").(uuid.UUID)
	itemIDStr := c.Param("itemId")
	itemID, err := uuid.Parse(itemIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid item ID"})
		return
	}
	item, err := h.store.GetListItem(c.Request.Context(), itemID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Item not found"})
			return
		}
		h.logger.Error("failed to get list item", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get list item"})
		return
	}
	list, err := h.store.GetList(c.Request.Context(), item.ListID)
	if err != nil || list.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}
	if err := h.store.DeleteListItem(c.Request.Context(), itemID); err != nil {
		h.logger.Error("failed to delete list item", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete list item"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}
