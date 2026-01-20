package hub

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/robfig/cron/v3"
	"go.uber.org/zap"
)

type Scheduler struct {
	store  *storage.Storage
	hub    *Hub
	logger *zap.Logger
}

func NewScheduler(store *storage.Storage, hub *Hub, logger *zap.Logger) *Scheduler {
	return &Scheduler{
		store:  store,
		hub:    hub,
		logger: logger.With(zap.String("component", "scheduler")),
	}
}

func (s *Scheduler) Start() {
	s.logger.Info("starting scheduler")
	ticker := time.NewTicker(10 * time.Second) // Check every 10 seconds
	for range ticker.C {
		s.checkTasks()
	}
}

func (s *Scheduler) checkTasks() {
	ctx := context.Background()
	tasks, err := s.store.GetDueTasks(ctx)
	if err != nil {
		s.logger.Error("failed to get due tasks", zap.Error(err))
		return
	}

	for _, task := range tasks {
		s.logger.Info("executing task", zap.String("task_id", task.ID.String()))
		go s.executeTask(ctx, task)
	}
}

func (s *Scheduler) executeTask(ctx context.Context, task storage.Task) {
	// 1. Mark as running
	if err := s.store.UpdateTaskStatus(ctx, task.ID, storage.TaskStatusRunning, ""); err != nil {
		s.logger.Error("failed to mark task running", zap.Error(err))
		return
	}

	// 2. Execute
	var err error
	if task.Type == "agent_message" {
		err = s.executeAgentMessage(ctx, task)
	} else {
		s.logger.Warn("unknown task type", zap.String("type", task.Type))
	}

	// 3. Mark as completed or failed
	if err != nil {
		s.store.UpdateTaskStatus(ctx, task.ID, storage.TaskStatusFailed, err.Error())
	} else {
		// Handle Recurrence if CronExpr is set
		if task.CronExpr != "" {
			// Calculate next run
			parser := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
			schedule, err := parser.Parse(task.CronExpr)
			if err != nil {
				s.logger.Error("failed to parse cron expr", zap.Error(err), zap.String("expr", task.CronExpr))
				s.store.UpdateTaskStatus(ctx, task.ID, storage.TaskStatusFailed, "invalid cron expression")
			} else {
				nextRun := schedule.Next(time.Now().UTC())
				s.logger.Info("rescheduling task", zap.String("task_id", task.ID.String()), zap.Time("next_run", nextRun))
				s.store.RescheduleTask(ctx, task.ID, nextRun)
			}
		} else {
			s.store.UpdateTaskStatus(ctx, task.ID, storage.TaskStatusCompleted, "")
		}
	}
}

func (s *Scheduler) executeAgentMessage(ctx context.Context, task storage.Task) error {
	// Parse payload
	var payload struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(task.Payload, &payload); err != nil {
		return err
	}

	// Logic:
	// We want to simulate the user sending this message.
	// We need to inject it into the Room.

	// 1. Get Room
	// We can access Hub.rooms, but it's protected.
	// We can use Hub.GetRoom or similar if exposed.
	// But Hub doesn't expose GetRoom.
	// We can use Hub.ServeWs logic... but we don't have a WS connection.

	// We need a way to "Send Message" to a Room without a Client.
	// Or force create a room.

	// Let's modify Hub to expose GetOrCreateRoom
	// Added RoomTypeChat as the second argument
	room, err := s.hub.GetOrCreateRoom(task.ChatID, RoomTypeChat, task.UserID, "agent", "") // Scheduled tasks use agent mode
	if err != nil {
		return err
	}

	// 2. Inject Message
	// We need to create a "Virtual Client" or just direct injection.
	// The Room handles messages via `handleUserMessage`.
	// But that expects `*ClientMessage`.
	// Let's see `ClientMessage`.
	/*
		type ClientMessage struct {
			Client  *Client
			Payload []byte
		}
	*/
	// We don't have a Client.
	// However, `handleUserMessage` uses `msg.Client` primarily for broadcasting and `msg.Client.userID`.
	// If we pass a dummy Client with the correct UserID, it might work?
	// But `Client.send` channel is used for broadcast. If we pass a dummy with nil channel, it might panic.

	// BETTER APPROACH:
	// Refactor Room to have `ProcessMessage(userID, frame)` method that can be called by both WebSocket handler and Scheduler.

	// For now, let's construct a minimal valid frame and inject.
	msgID := uuid.New()

	// Unmarshal tools from task if they exist
	var tools interface{}
	if len(task.Tools) > 0 {
		if err := json.Unmarshal(task.Tools, &tools); err != nil {
			s.logger.Warn("failed to unmarshal task tools", zap.Error(err))
		}
	}

	// Construct payload map for json.RawMessage
	payloadMap := map[string]interface{}{
		"message_id": msgID,
		"message":    payload.Message,
		"role":       "system",
		"tools":      tools,
	}
	payloadBytesRaw, _ := json.Marshal(payloadMap)

	frame := Frame{
		ChatID:    task.ChatID,
		Operation: MessageOperation,
		Kind:      TokenKind, // Ensure Kind is set
		Timestamp: time.Now().UTC(),
		Payload:   payloadBytesRaw,
	}
	frameBytes, _ := json.Marshal(frame)

	// Direct injection into Room logic
	// We can't access `room.ingress` easily if it's private.
	// And `handleUserMessage` is private.

	// We should expose `InjectMessage` on Room.
	room.InjectMessage(task.UserID, frameBytes)

	return nil
}
