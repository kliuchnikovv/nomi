import { Chat } from '../../main/models';

export interface ChatSidebarProps {
    variant: 'inline' | 'overlay';
    width: number;
    visible?: boolean;
    chats: Chat[];
    chatsLoading?: boolean;
    activeChatID?: string | null;
    onClose?: () => void;
    onSelectChat: (chatId: string) => void;
    onNewChat: () => void;
    onSettingsPress?: () => void;
    onChatDelete?: (chatId: string) => void;
    onChatRename?: (chatId: string, newTitle: string) => void;
}
