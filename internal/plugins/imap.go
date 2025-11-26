package plugins

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
)

// IMAPBackend describes a backend implementation that can be wrapped as an IMAP plugin.
type IMAPBackend interface {
	Info() Info
	DefaultState() map[string]interface{}
	Init(ctx context.Context, rt *Runtime, state map[string]interface{}) error
	Status(ctx context.Context, state map[string]interface{}) (map[string]interface{}, error)
	Shutdown(ctx context.Context) error
}

// NewIMAPPlugin constructs a plugin around the provided backend implementation.
func NewIMAPPlugin(backend IMAPBackend) Plugin {
	return &imapPlugin{backend: backend}
}

type imapPlugin struct {
	backend IMAPBackend
	state   map[string]interface{}
	rt      *Runtime
}

func (p *imapPlugin) Info() Info {
	return p.backend.Info()
}

func (p *imapPlugin) DefaultState() map[string]interface{} {
	base := map[string]interface{}{
		"connected": false,
		"mailbox":   "INBOX",
	}
	for k, v := range p.backend.DefaultState() {
		base[k] = v
	}
	return base
}

func (p *imapPlugin) Init(ctx context.Context, rt *Runtime, state map[string]interface{}) error {
	p.state = state
	p.rt = rt
	return p.backend.Init(ctx, rt, state)
}

func (p *imapPlugin) RegisterRoutes(router *gin.RouterGroup) {
	router.GET("/status", p.status)
	router.POST("/routines/:name", p.runRoutine)
}

func (p *imapPlugin) Shutdown(ctx context.Context) error {
	return p.backend.Shutdown(ctx)
}

func (p *imapPlugin) status(c *gin.Context) {
	status, err := p.backend.Status(c.Request.Context(), p.state)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"plugin": p.Info(), "state": p.state, "status": status})
}

func (p *imapPlugin) runRoutine(c *gin.Context) {
	routine := c.Param("name")
	var payload map[string]interface{}
	_ = c.ShouldBindJSON(&payload)
	if err := p.rt.RunRoutine(c.Request.Context(), p.Info().Name, routine, payload); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusAccepted)
}
