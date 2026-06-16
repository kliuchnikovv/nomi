package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

// ProjectDocumentHandler manages files attached to a project. It stores a
// lightweight metadata row in Postgres and delegates parsing/chunking/embedding
// (and vector removal) to the Python brain, which owns the vector store.
type ProjectDocumentHandler struct {
	storage *storage.Storage
	cfg     *config.Config
	logger  *zap.Logger
	client  *http.Client
}

func NewProjectDocumentHandler(store *storage.Storage, cfg *config.Config, logger *zap.Logger) *ProjectDocumentHandler {
	return &ProjectDocumentHandler{
		storage: store,
		cfg:     cfg,
		logger:  logger,
		client:  &http.Client{Timeout: 180 * time.Second},
	}
}

// allowedDocExt maps the supported document extensions to the file_type stored
// on the row and forwarded to the brain for parser selection.
var allowedDocExt = map[string]string{
	".txt": "text/plain",
	".md":  "text/markdown",
	".pdf": "application/pdf",
}

func (h *ProjectDocumentHandler) backendURL() string {
	if h.cfg.LLM.BaseURL != "" {
		return h.cfg.LLM.BaseURL
	}
	return "http://127.0.0.1:7777"
}

// UploadProjectDocument handles POST /api/projects/:id/documents (multipart).
func (h *ProjectDocumentHandler) UploadProjectDocument(c *gin.Context) {
	ctx := c.Request.Context()

	projectID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	// Ensure the project exists and belongs to the user.
	if _, err := h.storage.GetProject(ctx, user.ID, projectID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}

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

	ext := strings.ToLower(filepath.Ext(header.Filename))
	fileType, ok := allowedDocExt[ext]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported file type; allowed: .txt, .md, .pdf"})
		return
	}

	content, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}

	doc := &storage.ProjectDocument{
		ProjectID: projectID,
		UserID:    user.ID,
		FileName:  header.Filename,
		FileType:  fileType,
		Size:      header.Size,
		Status:    "indexing",
	}
	if err := h.storage.CreateProjectDocument(ctx, doc); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save document"})
		return
	}

	// Parse + chunk + embed on the Python brain (synchronous: we want the final
	// status in the response so the UI can reflect it immediately).
	chunkCount, indexErr := h.indexDocument(ctx, indexDocumentRequest{
		DocumentID: doc.ID.String(),
		ProjectID:  projectID.String(),
		UserID:     user.ID.String(),
		FileName:   header.Filename,
		FileType:   fileType,
		ContentB64: base64.StdEncoding.EncodeToString(content),
	})
	if indexErr != nil {
		h.logger.Error("UploadProjectDocument: indexing failed", zap.Error(indexErr), zap.String("doc_id", doc.ID.String()))
		_ = h.storage.UpdateProjectDocumentStatus(ctx, doc.ID, "failed", 0, indexErr.Error())
		doc.Status = "failed"
		doc.Error = indexErr.Error()
		c.JSON(http.StatusOK, doc)
		return
	}

	_ = h.storage.UpdateProjectDocumentStatus(ctx, doc.ID, "ready", chunkCount, "")
	doc.Status = "ready"
	doc.ChunkCount = chunkCount
	c.JSON(http.StatusOK, doc)
}

// ListProjectDocuments handles GET /api/projects/:id/documents.
func (h *ProjectDocumentHandler) ListProjectDocuments(c *gin.Context) {
	ctx := c.Request.Context()

	projectID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	docs, err := h.storage.ListProjectDocuments(ctx, user.ID, projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list documents"})
		return
	}
	c.JSON(http.StatusOK, docs)
}

// DeleteProjectDocument handles DELETE /api/projects/:id/documents/:docId.
func (h *ProjectDocumentHandler) DeleteProjectDocument(c *gin.Context) {
	ctx := c.Request.Context()

	projectID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}
	docID, err := uuid.Parse(c.Param("docId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid document ID"})
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	doc, err := h.storage.GetProjectDocument(ctx, user.ID, docID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Document not found"})
		return
	}

	if err := h.storage.DeleteProjectDocument(ctx, user.ID, docID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete document"})
		return
	}

	// Best-effort vector cleanup on the brain. The row is already gone; log only.
	if err := h.removeVectors(ctx, doc.UserID.String(), projectID.String(), docID.String()); err != nil {
		h.logger.Warn("DeleteProjectDocument: vector removal failed", zap.Error(err), zap.String("doc_id", docID.String()))
	}

	c.JSON(http.StatusNoContent, nil)
}

// ── Python brain calls ──────────────────────────────────────────────

type indexDocumentRequest struct {
	DocumentID string `json:"document_id"`
	ProjectID  string `json:"project_id"`
	UserID     string `json:"user_id"`
	FileName   string `json:"file_name"`
	FileType   string `json:"file_type"`
	ContentB64 string `json:"content_b64"`
}

func (h *ProjectDocumentHandler) indexDocument(ctx context.Context, req indexDocumentRequest) (int, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return 0, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, h.backendURL()+"/rag/index_document", bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := h.client.Do(httpReq)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, &backendError{status: resp.StatusCode, body: string(respBody)}
	}

	var parsed struct {
		ChunkCount int `json:"chunk_count"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return 0, err
	}
	return parsed.ChunkCount, nil
}

func (h *ProjectDocumentHandler) removeVectors(ctx context.Context, userID, projectID, documentID string) error {
	body, err := json.Marshal(map[string]string{
		"user_id":     userID,
		"project_id":  projectID,
		"document_id": documentID,
	})
	if err != nil {
		return err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, h.backendURL()+"/rag/remove", bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := h.client.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &backendError{status: resp.StatusCode, body: string(respBody)}
	}
	return nil
}

type backendError struct {
	status int
	body   string
}

func (e *backendError) Error() string {
	return "brain returned " + http.StatusText(e.status) + ": " + e.body
}
