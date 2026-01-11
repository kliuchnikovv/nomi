import { IMessage as GiftedChatMessage } from 'react-native-gifted-chat';

export interface Model {
    id: string;
    name: string;
    description?: string;
    provider?: string;
}

export interface ModelDetail {
    id: string;
    name: string;
    provider: string;
    description: string;
    context_window: number;
    supports_streaming: boolean;
    supports_tools: boolean;
    supports_thinking?: boolean;
}


export interface ModelsResponse {
    models: ModelDetail[];
}

// Re-export GiftedChat's user type or define our own compatible one
export interface IUser {
  _id: string | number;
  name?: string;
  avatar?: string | number | ((props: any) => any);
}

// Extended IMessage to support our custom fields while staying compatible with GiftedChat
export interface IMessage extends GiftedChatMessage {
  _id: string | number;
  text: string;
  createdAt: Date | number;
  user: IUser;
  image?: string;
  video?: string;
  audio?: string;
  system?: boolean;
  sent?: boolean;
  received?: boolean;
  pending?: boolean;
  quickReplies?: any; // strict typing if needed: QuickReplies
  // Custom fields
  tool_calls?: any[]; // using any for now or strictly ToolCall[] if we move that type here
  model?: string;
}

// State for the store
export interface ChatState {
    chats: Record<string, IMessage[]>;
    addMessage: (chatId: string, message: IMessage) => void;
    setMessages: (chatId: string, messages: IMessage[]) => void;
    updateMessageStatus: (chatId: string, msgId: string | number, status: Partial<IMessage>) => void;
}
