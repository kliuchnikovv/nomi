package plugins

import "context"

// NewGenericIMAPPlugin creates a configurable IMAP plugin with default host/port placeholders.
func NewGenericIMAPPlugin() Plugin {
	return NewIMAPPlugin(&genericIMAPBackend{})
}

type genericIMAPBackend struct{}

func (g *genericIMAPBackend) Info() Info {
	return Info{
		Name:        "imap",
		Description: "Generic IMAP integration plugin",
		Version:     "0.1.0",
	}
}

func (g *genericIMAPBackend) DefaultState() map[string]interface{} {
	return map[string]interface{}{
		"imap_host": "imap.example.com",
		"imap_port": 993,
		"username":  "user@example.com",
	}
}

func (g *genericIMAPBackend) Init(ctx context.Context, rt *Runtime, state map[string]interface{}) error {
	// Hook for initializing IMAP connections or credentials.
	return nil
}

func (g *genericIMAPBackend) Status(ctx context.Context, state map[string]interface{}) (map[string]interface{}, error) {
	return map[string]interface{}{
		"provider":  "generic_imap",
		"connected": state["connected"],
		"mailbox":   state["mailbox"],
	}, nil
}

func (g *genericIMAPBackend) Shutdown(ctx context.Context) error {
	return nil
}
