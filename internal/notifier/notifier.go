package notifier

import (
    "sync"
    "github.com/google/uuid"
)

// Event represents a server->client notification payload.
type Event struct {
    Type    string      `json:"type"`
    Payload interface{} `json:"payload"`
}

// Notifier is a simple in-memory pub/sub per chat.
type Notifier struct {
    mu        sync.RWMutex
    listeners map[uuid.UUID]map[chan Event]struct{}
}

func New() *Notifier {
    return &Notifier{listeners: make(map[uuid.UUID]map[chan Event]struct{})}
}

// Subscribe returns a channel for receiving events for a chat.
func (n *Notifier) Subscribe(chatID uuid.UUID) chan Event {
    ch := make(chan Event, 8)
    n.mu.Lock()
    if n.listeners[chatID] == nil {
        n.listeners[chatID] = make(map[chan Event]struct{})
    }
    n.listeners[chatID][ch] = struct{}{}
    n.mu.Unlock()
    return ch
}

// Unsubscribe removes the channel from listeners and closes it.
func (n *Notifier) Unsubscribe(chatID uuid.UUID, ch chan Event) {
    n.mu.Lock()
    if subs, ok := n.listeners[chatID]; ok {
        if _, ok := subs[ch]; ok {
            delete(subs, ch)
        }
        if len(subs) == 0 {
            delete(n.listeners, chatID)
        }
    }
    n.mu.Unlock()
    close(ch)
}

// Publish sends an event to all subscribers of a chat.
func (n *Notifier) Publish(chatID uuid.UUID, ev Event) {
    n.mu.RLock()
    subs := n.listeners[chatID]
    for ch := range subs {
        select {
        case ch <- ev:
        default:
            // drop if slow consumer; keep server healthy
        }
    }
    n.mu.RUnlock()
}

