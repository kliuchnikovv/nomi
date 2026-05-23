import React from 'react';
import { useChatOptional } from '../context';
import { MessageBubble } from '../../../components/chat/MessageBubble';
import { Message, MessageAction } from '../../main/models';

type Props = {
    message: Message;
    actions: MessageAction[] | null;
    header?: string | null;
    importance?: string | null;
    onActionPress?: (action: MessageAction) => Promise<void>;
};

const MessageScreen = React.memo(function MessageScreen(props: Props) {
    const chat = useChatOptional();
    return (
        <MessageBubble
            message={props.message}
            actions={props.actions}
            header={props.header}
            importance={props.importance}
            onActionPress={props.onActionPress}
            showToolCalls={chat?.showToolCalls ?? true}
            showReasoning={chat?.showReasoning ?? true}
        />
    );
});

export default MessageScreen;
