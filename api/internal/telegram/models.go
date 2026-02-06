package telegram

// TelegramUpdate represents an incoming Telegram webhook update (subset).
type TelegramUpdate struct {
	UpdateID      int64            `json:"update_id"`
	Message       *TelegramMessage `json:"message,omitempty"`
	CallbackQuery *CallbackQuery   `json:"callback_query,omitempty"`
}

// TelegramMessage represents a Telegram message (subset).
type TelegramMessage struct {
	MessageID int64         `json:"message_id"`
	From      *TelegramFrom `json:"from,omitempty"`
	Chat      TelegramChat  `json:"chat"`
	Date      int64         `json:"date"`
	Text      string        `json:"text,omitempty"`
	Photo     []PhotoSize   `json:"photo,omitempty"`
}

// TelegramFrom represents the sender of a Telegram message.
type TelegramFrom struct {
	ID        int64  `json:"id"`
	IsBot     bool   `json:"is_bot"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name,omitempty"`
	Username  string `json:"username,omitempty"`
}

// TelegramChat represents a Telegram chat.
type TelegramChat struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
}

// PhotoSize represents a Telegram photo size.
type PhotoSize struct {
	FileID       string `json:"file_id"`
	FileUniqueID string `json:"file_unique_id"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	FileSize     int    `json:"file_size,omitempty"`
}

// CallbackQuery represents a Telegram callback query (inline button press).
type CallbackQuery struct {
	ID      string           `json:"id"`
	From    TelegramFrom     `json:"from"`
	Message *TelegramMessage `json:"message,omitempty"`
	Data    string           `json:"data,omitempty"`
}
