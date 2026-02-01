package hub

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

func (r *Room) routeMessage(msg *ClientMessage, frame Frame, originalChatID uuid.UUID) {
	r.logger.Info("routing message from user channel to chat room",
		zap.String("chat_id", originalChatID.String()),
		zap.String("user_id", r.initiatorID.String()),
	)

	chatMode := r.mode
	chatCommand := r.command

	chatRecord, err := r.store.GetChat(context.Background(), r.initiatorID, originalChatID)
	if err == nil && chatRecord != nil {
		if chatRecord.Mode != "" {
			chatMode = chatRecord.Mode
		}
		if chatRecord.TeamID != nil && *chatRecord.TeamID != "" {
			chatCommand = fmt.Sprintf(`{"type":"%s"}`, *chatRecord.TeamID)
		}
	}

	chatRoom, err := r.hub.GetOrCreateRoom(originalChatID, RoomTypeChat, r.initiatorID, chatMode, chatCommand)
	if err != nil {
		r.logger.Error("failed to get chat room for routing", zap.Error(err))
	} else {
		chatRoom.InjectMessage(msg.Client.userID, msg.Payload)
	}
}
