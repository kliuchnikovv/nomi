import { Chat, Message } from '../main/models';
import {ReactNode} from 'react';

export type Props = {
    children: ReactNode;
    chat: Chat | null;
    activeChatID: string;
    setActiveChatID: (id: string) => void;
    getChats: () => void;
};

export interface ChatContextType {
    messages: Message[];
    getMessages: (chatId: string) => void;
    sendMessage: (text: string) => void;
    assistantWorking: boolean;
}
