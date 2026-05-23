import { Message, MessageAction } from '../../screens/main/models';
import type { ChatMessage } from '../../screens/planner/hooks/usePlannerChat';

export const ASK_USER_REPLY_COMMAND = 'ask_user_reply';

export type AskUserReplyAction = MessageAction & {
    command: typeof ASK_USER_REPLY_COMMAND;
    callId: string;
};

export function plannerMessageToMessage(cm: ChatMessage): Message {
    const actions: AskUserReplyAction[] | undefined = cm.askUser
        ? cm.askUser.options.map(opt => ({
              command: ASK_USER_REPLY_COMMAND as typeof ASK_USER_REPLY_COMMAND,
              callId: cm.askUser!.callId,
              label: opt,
              prompt: opt,
          }))
        : undefined;

    return {
        id: cm.id,
        chat_id: 'planner',
        sender: cm.role,
        role: cm.role,
        text: cm.text,
        created_at: cm.created_at ?? 0,
        actions,
        metadata: cm.metadata,
    };
}

export function isAskUserReply(
    action: MessageAction,
): action is AskUserReplyAction {
    return action.command === ASK_USER_REPLY_COMMAND;
}
