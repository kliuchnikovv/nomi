package plugins

import "context"

// NewGmailPlugin returns a Gmail-specific IMAP plugin implementation.
func NewGmailPlugin() Plugin {
	return NewIMAPPlugin(&gmailBackend{})
}

type gmailBackend struct{}

func (g *gmailBackend) Info() Info {
	return Info{
		Name:        "gmail",
		Description: "Gmail integration plugin built on IMAP",
		Version:     "0.2.0",
	}
}

func (g *gmailBackend) DefaultState() map[string]interface{} {
	return map[string]interface{}{
		"permissions": []string{"gmail:read"},
		"imap_host":   "imap.gmail.com",
		"imap_port":   993,
	}
}

func (g *gmailBackend) Init(ctx context.Context, rt *Runtime, state map[string]interface{}) error {
	// Gmail-specific initialization can be added here (OAuth tokens, label sync, etc.).
	return nil
}

func (g *gmailBackend) Status(ctx context.Context, state map[string]interface{}) (map[string]interface{}, error) {
	// In a real implementation, this would check connectivity and mailboxes.
	return map[string]interface{}{
		"provider":  "gmail",
		"connected": state["connected"],
		"mailbox":   state["mailbox"],
	}, nil
}

func (g *gmailBackend) Shutdown(ctx context.Context) error {
	return nil
}
