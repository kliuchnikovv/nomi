import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '../../../apiClient';
import { getApiUrl } from '../../../config';
import { ChatSocket } from '../../../socket';
import { authStore } from '../../../apiClient';
import { Chat, Frame } from '../../main/models';
import { callApplyPatches } from '../planDocumentRegistry';
import {
  PLANNER_MODEL_KEY,
  PLANNER_PROVIDER_KEY,
} from '../../settings/screen';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export interface UsePlannerChatResult {
  messages: ChatMessage[];
  sendMessage: (text: string, options?: { webSearch?: boolean }) => void;
  isConnected: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const PLANNER_CHAT_TITLE = 'Planner';
const PLANNER_CHAT_MODE = 'agent';
const DEFAULT_MODEL = 'glm-4.7';
const DEFAULT_PROVIDER = 'z.ai';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlannerChat(): UsePlannerChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const chatIdRef = useRef<string | null>(null);
  const chatModelRef = useRef<string>(DEFAULT_MODEL);
  const chatProviderRef = useRef<string>(DEFAULT_PROVIDER);
  // Dedicated socket instance — does NOT share with the main chat screen
  const wsRef = useRef<ChatSocket | null>(null);
  // Poll connection status periodically
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track in-progress streaming message id
  const streamingMsgIdRef = useRef<string | null>(null);

  // ---------------------------------------------------------------------------
  // Find or create Planner chat, then connect dedicated socket
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const ws = new ChatSocket();
    wsRef.current = ws;

    async function bootstrap() {
      try {
        // 1. Read user-selected model from settings
        const [savedModel, savedProvider] = await Promise.all([
          AsyncStorage.getItem(PLANNER_MODEL_KEY),
          AsyncStorage.getItem(PLANNER_PROVIDER_KEY),
        ]);
        const model = savedModel ?? DEFAULT_MODEL;
        const provider = savedProvider ?? DEFAULT_PROVIDER;
        chatModelRef.current = model;
        chatProviderRef.current = provider;

        // 2. List chats, look for existing Planner chat
        const chats = await apiClient.get<Chat[]>(`${getApiUrl()}/chats`);
        if (cancelled) return;

        let plannerChat: Chat | undefined;
        if (Array.isArray(chats)) {
          plannerChat = chats.find(
            c => c.title === PLANNER_CHAT_TITLE && c.mode === PLANNER_CHAT_MODE,
          );
        }

        // 3. Create if not found
        if (!plannerChat) {
          const created = await apiClient.post<{ id: string }>(
            `${getApiUrl()}/chats`,
            { title: PLANNER_CHAT_TITLE, mode: PLANNER_CHAT_MODE, model, team_id: null },
          );
          if (cancelled) return;
          if (!created?.id) {
            console.error('[usePlannerChat] Failed to create Planner chat');
            return;
          }
          chatIdRef.current = created.id;
        } else {
          // Update model on server if changed
          if (plannerChat.model !== model) {
            await apiClient.patch(`${getApiUrl()}/chats/${plannerChat.id}`, { model });
          }
          chatIdRef.current = plannerChat.id;

          // 4. Load chat history
          try {
            const history = await apiClient.get<{ id: string; role: string; text: string }[]>(
              `${getApiUrl()}/chats/${plannerChat.id}/messages`,
            );
            if (!cancelled && Array.isArray(history)) {
              const mapped: ChatMessage[] = history
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => ({
                  id: m.id,
                  role: m.role as 'user' | 'assistant',
                  text: m.text ?? '',
                }));
              setMessages(mapped);
            }
          } catch {
            // History unavailable — start fresh, no-op
          }
        }

        if (cancelled) return;

        // 5. Connect dedicated socket
        const token = authStore.getToken();
        if (!token) {
          console.warn('[usePlannerChat] No auth token');
          return;
        }

        ws.setChannel('chat');
        ws.setChatId(chatIdRef.current);
        ws.setToken(token);

        ws.setHandlers({
          onMessage: (frame: Frame) => {
            if (!frame.payload) return;
            const { type, message, delta, actions } = frame.payload;
            const msgId: string =
              (frame.payload as any).message_id ?? String(frame.id || generateId());

            // Handle text responses (streaming + complete)
            if (type === 'text') {
              if (delta) {
                // Streaming chunk — accumulate into one bubble
                if (!streamingMsgIdRef.current) {
                  streamingMsgIdRef.current = msgId;
                  setMessages(prev => [
                    ...prev,
                    { id: msgId, role: 'assistant', text: delta },
                  ]);
                } else {
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === streamingMsgIdRef.current
                        ? { ...m, text: m.text + delta }
                        : m,
                    ),
                  );
                }
              } else if (message) {
                // Complete non-streaming message
                streamingMsgIdRef.current = null;
                setMessages(prev => {
                  const existing = prev.find(m => m.id === msgId);
                  if (existing) {
                    return prev.map(m =>
                      m.id === msgId ? { ...m, text: message } : m,
                    );
                  }
                  return [...prev, { id: msgId, role: 'assistant', text: message }];
                });
              }
            }

            // Handle client_action (patch_plan_document tool calls)
            if (type === 'client_action' && actions) {
              for (const action of actions) {
                if (action.tool === 'patch_plan_document') {
                  const patches = action.params?.patches ?? [];
                  const summary = action.params?.summary;
                  callApplyPatches(patches, summary);
                }
              }
            }
          },
          onDone: () => {
            streamingMsgIdRef.current = null;
          },
          onError: (err: any) => {
            console.warn('[usePlannerChat] socket error:', err);
            streamingMsgIdRef.current = null;
          },
          onReconnect: () => {
            setIsConnected(true);
          },
        });

        ws.connect();

        // Poll connection status periodically until connected
        pollTimerRef.current = setInterval(() => {
          if (cancelled) {
            if (pollTimerRef.current) {
              clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }
            return;
          }
          const ready = ws.isReady();
          setIsConnected(ready);
          if (ready && pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        }, 500);
      } catch (err) {
        console.error('[usePlannerChat] bootstrap error:', err);
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      ws.close();
      wsRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // sendMessage
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback(
    (text: string, options?: { webSearch?: boolean }) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const chatId = chatIdRef.current;
      const ws = wsRef.current;
      if (!chatId || !ws) {
        console.warn('[usePlannerChat] sendMessage called before chat is ready');
        return;
      }

      const msgId = generateId();
      const sessionId = `planner_${Date.now()}`;

      setMessages(prev => [...prev, { id: msgId, role: 'user', text: trimmed }]);
      streamingMsgIdRef.current = null;

      ws.sendMessage(
        trimmed,
        chatId,
        sessionId,
        msgId,
        [],
        options?.webSearch ?? false,
        undefined,
        undefined,
        chatModelRef.current,
        chatProviderRef.current,
      );
    },
    [],
  );

  return { messages, sendMessage, isConnected };
}
