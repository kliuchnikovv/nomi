package hub

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

const (
	workerWriteWait  = 10 * time.Second
	workerPongWait   = 60 * time.Second
	workerPingPeriod = (workerPongWait * 9) / 10
)

var (
	errNoWorkers  = fmt.Errorf("no python workers connected")
	errWorkerBusy = fmt.Errorf("worker send buffer full")
)

// WorkerPool manages persistent WebSocket connections from Python workers.
// Response frames from Python arrive here and are routed directly to rooms,
// bypassing the Redis pub/sub hop.
type WorkerPool struct {
	mu         sync.RWMutex
	workers    []*WorkerConn
	chatWorker map[uuid.UUID]*WorkerConn // sticky: chatID → worker for request dispatch
	logger     *zap.Logger
}

func NewWorkerPool(logger *zap.Logger) *WorkerPool {
	return &WorkerPool{
		chatWorker: make(map[uuid.UUID]*WorkerConn),
		logger:     logger.With(zap.String("component", "worker_pool")),
	}
}

// HasWorkers reports whether at least one Python worker is connected.
func (p *WorkerPool) HasWorkers() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return len(p.workers) > 0
}

// Dispatch sends a request frame to the worker handling chatID (round-robin with stickiness).
// Returns errNoWorkers if no workers are connected so the caller can fall back to Redis.
func (p *WorkerPool) Dispatch(chatID uuid.UUID, data []byte) error {
	p.mu.Lock()
	if len(p.workers) == 0 {
		p.mu.Unlock()
		return errNoWorkers
	}
	wc, ok := p.chatWorker[chatID]
	if !ok || !wc.isAlive() {
		idx := int(chatID[0]) % len(p.workers)
		wc = p.workers[idx]
		p.chatWorker[chatID] = wc
	}
	p.mu.Unlock()

	select {
	case wc.send <- data:
		return nil
	default:
		return errWorkerBusy
	}
}

// ServeWorker registers a new Python worker connection and blocks until it closes.
func (p *WorkerPool) ServeWorker(conn *websocket.Conn, hub *Hub) {
	wc := p.register(conn, hub)
	wc.serve()
}

func (p *WorkerPool) register(conn *websocket.Conn, hub *Hub) *WorkerConn {
	wc := &WorkerConn{
		id:          uuid.New(),
		pool:        p,
		hub:         hub,
		conn:        conn,
		send:        make(chan []byte, 256),
		done:        make(chan struct{}),
		lastFrameID: make(map[uuid.UUID]int),
	}
	p.mu.Lock()
	p.workers = append(p.workers, wc)
	p.mu.Unlock()
	p.logger.Info("python worker connected", zap.String("worker_id", wc.id.String()), zap.Int("total", len(p.workers)))
	return wc
}

func (p *WorkerPool) remove(wc *WorkerConn) {
	select {
	case <-wc.done:
	default:
		close(wc.done)
	}
	p.mu.Lock()
	for i, w := range p.workers {
		if w.id == wc.id {
			p.workers = append(p.workers[:i], p.workers[i+1:]...)
			break
		}
	}
	for chatID, w := range p.chatWorker {
		if w.id == wc.id {
			delete(p.chatWorker, chatID)
		}
	}
	p.mu.Unlock()
	p.logger.Info("python worker disconnected", zap.String("worker_id", wc.id.String()), zap.Int("total", len(p.workers)))
}

// resumeSession is the per-chat payload in a worker RESUME frame.
type resumeSession struct {
	ChatID   string `json:"chat_id"`
	LastSent int    `json:"last_sent"`
}

// resumeFrame is the control frame Python sends on (re)connect.
type resumeFrame struct {
	Op       string          `json:"op"`
	Sessions []resumeSession `json:"sessions"`
}

// WorkerConn represents one connected Python worker.
type WorkerConn struct {
	id          uuid.UUID
	pool        *WorkerPool
	hub         *Hub
	conn        *websocket.Conn
	send        chan []byte // outbound frames (Go→Python: resume_ack + future requests)
	done        chan struct{}
	lastFrameMu sync.Mutex
	lastFrameID map[uuid.UUID]int // last frame.ID delivered per chatID (de-dup)
}

func (wc *WorkerConn) isAlive() bool {
	select {
	case <-wc.done:
		return false
	default:
		return true
	}
}

// serve runs read and write pumps; blocks until the connection closes.
func (wc *WorkerConn) serve() {
	go wc.writePump()
	wc.readPump()
}

func (wc *WorkerConn) writePump() {
	ticker := time.NewTicker(workerPingPeriod)
	defer func() {
		ticker.Stop()
		wc.conn.Close()
	}()
	for {
		select {
		case data, ok := <-wc.send:
			wc.conn.SetWriteDeadline(time.Now().Add(workerWriteWait))
			if !ok {
				wc.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := wc.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		case <-ticker.C:
			wc.conn.SetWriteDeadline(time.Now().Add(workerWriteWait))
			if err := wc.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-wc.done:
			return
		}
	}
}

func (wc *WorkerConn) readPump() {
	defer func() {
		wc.pool.remove(wc)
		wc.conn.Close()
	}()
	wc.conn.SetReadDeadline(time.Now().Add(workerPongWait))
	wc.conn.SetPongHandler(func(string) error {
		wc.conn.SetReadDeadline(time.Now().Add(workerPongWait))
		return nil
	})
	for {
		_, msg, err := wc.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				wc.pool.logger.Warn("worker read error", zap.String("worker_id", wc.id.String()), zap.Error(err))
			}
			return
		}
		// Peek at op to intercept control frames before full Frame parse.
		var peek struct {
			Op string `json:"op"`
		}
		if err := json.Unmarshal(msg, &peek); err == nil && peek.Op == "worker_resume" {
			wc.handleResume(msg)
			continue
		}
		var frame Frame
		if err := json.Unmarshal(msg, &frame); err != nil {
			wc.pool.logger.Warn("worker: invalid frame", zap.Error(err))
			continue
		}
		wc.deliverFrame(frame)
	}
}

// handleResume processes a RESUME control frame from a Python worker on reconnect.
// It sends back a resume_ack with the last frame ID Go successfully delivered per chatID,
// letting Python know which re-queued frames are duplicates.
func (wc *WorkerConn) handleResume(msg []byte) {
	var rf resumeFrame
	if err := json.Unmarshal(msg, &rf); err != nil {
		wc.pool.logger.Warn("worker: invalid resume frame", zap.Error(err))
		return
	}
	type ackSession struct {
		ChatID       string `json:"chat_id"`
		LastReceived int    `json:"last_received"`
	}
	type ackFrame struct {
		Op       string       `json:"op"`
		Sessions []ackSession `json:"sessions"`
	}
	ack := ackFrame{Op: "worker_resume_ack"}
	wc.lastFrameMu.Lock()
	for _, s := range rf.Sessions {
		chatID, err := uuid.Parse(s.ChatID)
		if err != nil {
			continue
		}
		ack.Sessions = append(ack.Sessions, ackSession{
			ChatID:       s.ChatID,
			LastReceived: wc.lastFrameID[chatID],
		})
	}
	wc.lastFrameMu.Unlock()

	if b, err := json.Marshal(ack); err == nil {
		select {
		case wc.send <- b:
		default:
			wc.pool.logger.Warn("worker: resume_ack send buffer full")
		}
	}
	wc.pool.logger.Info("worker: processed resume", zap.Int("sessions", len(rf.Sessions)))
}

// deliverFrame routes a response frame from Python to the correct room,
// dropping duplicate frames (same frame.ID already delivered for this chatID).
func (wc *WorkerConn) deliverFrame(frame Frame) {
	if frame.ChatID == uuid.Nil {
		wc.pool.logger.Warn("worker: frame missing chat_id, dropping")
		return
	}

	// De-dup: if Go already delivered a frame with this ID for this chat, skip.
	wc.lastFrameMu.Lock()
	if frame.ID > 0 && frame.ID <= wc.lastFrameID[frame.ChatID] {
		wc.lastFrameMu.Unlock()
		wc.pool.logger.Debug("worker: duplicate frame dropped",
			zap.String("chat_id", frame.ChatID.String()), zap.Int("id", frame.ID))
		return
	}
	if frame.ID > wc.lastFrameID[frame.ChatID] {
		wc.lastFrameID[frame.ChatID] = frame.ID
	}
	wc.lastFrameMu.Unlock()

	// Look up room by chatID to get initiatorID, then use BroadcastToUser
	// so user rooms (notification contexts) also receive non-streaming frames.
	wc.hub.mu.RLock()
	room, ok := wc.hub.rooms[frame.ChatID]
	wc.hub.mu.RUnlock()

	if ok {
		wc.hub.BroadcastToUser(room.initiatorID, frame)
	} else {
		wc.pool.logger.Warn("worker: no room for chat_id", zap.String("chat_id", frame.ChatID.String()))
	}
}
