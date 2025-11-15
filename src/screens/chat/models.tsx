import { Chat, Message } from '../main/models';
import {ReactNode} from 'react';

export type Props = {
    children: ReactNode;
    activeChatID: string;
    setActiveChatID: (id: string) => void;
};

export interface ChatContextType {
    messages: Message[];
    getMessages: (chatId: string) => void;
    sendMessage: (text: string) => void;
    assistantWorking: boolean;
}
