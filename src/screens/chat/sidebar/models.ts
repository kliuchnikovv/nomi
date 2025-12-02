import { Chat } from '../../main/models';

export interface ChatSidebarProps {
    variant: 'inline' | 'overlay';
    width: number;
    visible?: boolean;
    chats: Chat[];
    activeChatID?: string | null;
    onClose?: () => void;
    onSelectChat: (chatId: string) => void;
    onNewChat: () => void;
}
