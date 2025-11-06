package streamer

type Event string

const (
	Token Event = "token"
	Done  Event = "done"
	Meta  Event = "meta"
)

type Frame struct {
	Event Event `json:"event"`
	Data  Data  `json:"data"`
}

type Data struct {
	Delta            string `json:"delta,omitempty"`
	Index            uint   `json:"index,omitempty"`
	FinishReason     string `json:"finish_reason,omitempty"`
	Type             string `json:"type,omitempty"`
	ChatID           string `json:"chat_id,omitempty"`
	PromptTokens     uint   `json:"prompt_tokens,omitempty"`
	CompletionTokens uint   `json:"completion_tokens,omitempty"`
}
