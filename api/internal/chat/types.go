package chat

// ToolCall represents a tool call within a message
type ToolCall struct {
	ID        string                 `json:"id"`
	Name      string                 `json:"name"`
	Type      string                 `json:"type,omitempty"`
	Function  *ToolCallFunction      `json:"function,omitempty"` // For OpenAI compatibility
	Arguments map[string]interface{} `json:"arguments,omitempty"`
	Result    interface{}            `json:"result,omitempty"`
	Status    string                 `json:"status,omitempty"` // e.g. "running", "completed", "failed"
}

// ToolCallFunction represents the function details in a tool call (OpenAI style)
type ToolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"` // JSON string
}

// Action represents a suggested user action (e.g. button)
type Action struct {
	ID          string                 `json:"id"`
	Label       string                 `json:"label"`
	Action      string                 `json:"action"` // e.g. "click", "navigate"
	Parameters  map[string]interface{} `json:"parameters,omitempty"`
	Description string                 `json:"description,omitempty"`
}

// Command represents a slash command or system command
type Command map[string]interface{}

// ContentPart represents a part of the message content
type ContentPart struct {
	Type      string    `json:"type"` // "text", "tool_call", "reasoning", "member_response"
	Text      string    `json:"text,omitempty"`
	Reasoning string    `json:"reasoning,omitempty"`
	ToolCall  *ToolCall `json:"tool_call,omitempty"`
	AgentName string    `json:"agent_name,omitempty"`
	ImageURL  *ImageURL `json:"image_url,omitempty"`
}

type ImageURL struct {
	URL    string `json:"url"`
	Detail string `json:"detail,omitempty"`
}
