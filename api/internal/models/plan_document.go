package models

import (
	"encoding/json"
	"time"
)

type PlanDocument struct {
	ID        string          `json:"id" db:"id"`
	UserID    string          `json:"user_id" db:"user_id"`
	Date      string          `json:"date" db:"date"`
	Items     json.RawMessage `json:"items" db:"items"`
	CreatedAt time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt time.Time       `json:"updated_at" db:"updated_at"`
}
