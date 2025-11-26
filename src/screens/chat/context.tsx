import { Frame, Message } from '../main/models';
import { apiClient } from '../../apiClient';
import React, {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
    useCallback,
} from 'react';
import { ChatContextType, Props, Model } from './models';
import { useAuth } from '../auth/context.tsx';
import { ChatSocket } from '../../socket';
import { API_URL } from '../../config.ts';
import { modelsApi } from '../../apiClient';

const emptyChatID = '00000000-0000-0000-0000-000000000000';

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function useChat() {
    const context = useContext(ChatContext);
    if (!context) {
        throw new Error('useChat must be used within a ChatProvider');
    }
    return context;
}

export function ChatProvider({
    children,
    activeChatID,
    setActiveChatID,
}: Props) {
    const [messages, setMessages] = useState<Message[]>([]);
    const socketRef = useRef<ChatSocket | null>(null); // Declare socketRef

    const [currentMessageID, setCurrentMessageID] = useState<string | null>(null);
    const [assistantWorking, setAssistantWorking] = useState<boolean>(false);

    // Model selection state
    const [selectedModel, setSelectedModel] = useState<string | null>('gemini-2.0-flash-exp');
    const [availableModels, setAvailableModels] = useState<Model[]>([]);

    const { user, token, refreshToken } = useAuth(); // Destructure token and refreshToken

    // const API_URL = 'https://disciplined-quietude-production-f4b1.up.railway.app';

    // Fetch messages when activeChatID changes
    useEffect(() => {
        if (activeChatID === emptyChatID) {
            setMessages([]);
        } else {
            getMessages(activeChatID);
        }
    }, [activeChatID]); // Dependency on activeChatID

    // Fetch available models on mount
    useEffect(() => {
        const fetchModels = async () => {
            try {
                const models = await modelsApi.getModels();
                if (models) {
                    setAvailableModels(models);
                }
            } catch (error) {
                console.error('Failed to fetch models:', error);
            }
        };
        fetchModels();
    }, []);

    useEffect(() => {
        console.log('WebSocket useEffect: activeChatID:', activeChatID);
        console.log(
            'WebSocket useEffect: token:',
            token ? token.substring(0, 10) + '...' : 'null',
        );
        console.log('WebSocket useEffect: condition result:', !token); // Only check for token

        if (!token) {
            // Only check for token
            console.warn(
                'WebSocket useEffect: Returning early due to missing token.',
            );
            socketRef.current?.close();
            socketRef.current = null;
            return;
        }

        // Не открываем сокет, пока у нас placeholder chat_id
        if (!activeChatID || activeChatID === emptyChatID) {
            // console.warn('WebSocket useEffect: Skipping WS init until real chat_id is set');
            socketRef.current?.close();
            socketRef.current = null;
            return;
        }

        if (!socketRef.current) {
            console.log('WebSocket useEffect: Initializing ChatSocket.');
            socketRef.current = newWebSocket(token, activeChatID);
        }

        console.log(`WebSocket useEffect: socket ready`)

        return () => {
            console.log('WS cleanup: deps changed', { activeChatID, token: !!token });
            socketRef.current?.close();
            socketRef.current = null;
        };
    }, [activeChatID, token, refreshToken, API_URL]); // Dependencies for WebSocket lifecycle

    const sendStreamingMessage = useCallback(
        async (text: string) => {
            if (!text.trim() || !user?.id) return;

            // Если чата ещё нет, создаём его через REST и монтируем id
            let chatIdToUse = activeChatID;
            if (!chatIdToUse || chatIdToUse === emptyChatID) {
                chatIdToUse = await createChat(text) || activeChatID;
            }

            let messageID = await createMessage(text, chatIdToUse);
            setCurrentMessageID(messageID!);

            // const tempUserMessageId = `user-${Date.now()}`;
            // const tempAssistantMessageId = `asst-${Date.now()}`;
            //
            const userMessage: Message = {
                id: messageID!,
                chat_id: chatIdToUse!,
                sender: user.id,
                role: 'user',
                text: text.trim(),
                created_at: Date.now(),
            };

            // const assistantMessage: Message = {
            //     id: tempAssistantMessageId,
            //     chat_id: chatIdToUse!,
            //     sender: 'assistant',
            //     role: 'assistant',
            //     text: '', // Start with empty text for streaming
            //     created_at: Date.now(),
            // };
            //
            setMessages(prevMessages => [
                ...prevMessages,
                userMessage,
                // assistantMessage,
            ]);

            const sessionId = `sess_${Date.now()}`;
            console.log(
                'sendStreamingMessage: socketRef.current:',
                socketRef.current,
            ); // Add this log
            if (!socketRef.current) {
                socketRef.current = newWebSocket(token!, activeChatID);
            }

            setAssistantWorking(true);
            // Теперь точно есть socketRef; sendMessage положит в outbox и откроет WS
            socketRef.current!.sendMessage(text.trim(), sessionId, messageID);
            console.log("WebSocket sendStreamingMessage: socketRef.current:", socketRef.current);
        },
        [activeChatID, user?.id, refreshToken, socketRef.current],
    ); // Dependencies for sendStreamingMessage

    // Keep getMessages for initial load and manual refresh if needed
    async function getMessages(chatID: string) {
        try {
            const data = await apiClient.get<Message[]>(
                `${API_URL}/chats/${chatID}/messages`,
            );
            if (!data) {
                return;
            }

            setMessages(data);
        } catch (error) {
            // alertError(`Failed to fetch messages for chat: ${error}`);
            console.error(
                `Failed to fetch messages for chat ${chatID}:`,
                error,
            );
        }
    }

    async function createChat(title: string) {
        let chatID: string;

        try {
            const created = await apiClient.post<{ id: string }>(
                `${API_URL}/chats`,
                {
                    "title": title,
                    "model": emptyChatID
                },
            );
            if (created?.id) {
                chatID = created.id;
                setActiveChatID(created.id);
                // подтянуть список чатов, чтобы отобразился новый
                // getChats();
            } else {
                console.error('Chat create returned no id', created);
                return;
            }
        } catch (e) {
            console.error('Failed to create chat before sending:', e);
            // alertError(`Не удалось создать чат: ${e}` as any);
            return;
        }

        return chatID;
    }

    async function createMessage(text: string, chatID: string) {
        let messageID: string;

        try {
            const created = await apiClient.post<{ id: string }>(
                `${API_URL}/chats/${chatID}/messages`,
                {
                    chat_id: chatID,
                    role: 'user',
                    text: text,
                },
            );
            if (created?.id) {
                messageID = created.id;
                setCurrentMessageID(created.id);
                console.log('messageID:', messageID);
            } else {
                console.error('Message create returned no id', created);
                return;
            }
        } catch (e) {
            console.error('Failed to create message before sending:', e);
            // alertError(`Не удалось создать сообщение: ${e}` as any);
            return;
        }

        return messageID;
    }

    // Modify sendMessage to use sendStreamingMessage
    const sendMessage = useCallback(
        async (text: string) => {
            await sendStreamingMessage(text);
        },
        [sendStreamingMessage],
    );

    function newWebSocket(tkn: string, chatID: string) {
        const sock = new ChatSocket(
            API_URL,
            () => tkn,
            () => chatID,
            () => currentMessageID,
            () => selectedModel,
        )

        sock.setHandlers({
            onMessage: (frame: Frame) => {
                console.log('onMessage: received message', frame);
                setMessages(prevMessages =>
                    onReceivedMessage(frame, prevMessages)
                );
            },
            onMeta: (frame: Frame) => {
                console.log('onMeta: received message', frame);
                // meta используется для побочных данных; chat_id теперь создаём явно через REST
            },
            onDone: (frame: Frame) => {
                console.log(`onDone: received message`, frame);
                setAssistantWorking(false);
                // getMessages();
            },
            onError: (err: any) => {
                console.error('WebSocket error:', err);
                // alertError(`WebSocket error: ${err?.error?.message || err}`);
            },
            onUnauthorized: async () => {
                return await refreshToken();
            },
        });

        return sock
    }

    function onReceivedMessage(frame: Frame, prevMessages: Message[]) {
        let newMessages: Message[] = [...prevMessages];

        const messageID = frame.payload.message_id
        if (!messageID) {
            console.error(`Frame got no message_id`, frame)
            return newMessages;
        }

        let messageIdx = newMessages.findIndex((item) => {
            return item.id === frame.payload.message_id;
        })

        if (messageIdx === -1) {
            messageIdx = newMessages.length
            newMessages[messageIdx] = {
                id: messageID,
                chat_id: activeChatID,
                sender: 'assistant',
                role: 'assistant',
                text: "",
                created_at: Date.now(),
            };
        }

        if (!frame.payload.eof) {
            newMessages[messageIdx].text += frame.payload.message
            console.log("frame captured", frame.payload.message, frame);
            console.log("newMessage", prevMessages, newMessages);
        } else {
            setAssistantWorking(false);
        }

        return newMessages;
    }

    const value: ChatContextType = {
        messages,
        getMessages,
        sendMessage, // Now uses the WebSocket version
        assistantWorking,
        selectedModel,
        setSelectedModel,
        availableModels,
    };

    return (
        <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
    );
}
