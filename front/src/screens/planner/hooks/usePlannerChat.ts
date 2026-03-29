import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../../../apiClient';
import { getApiUrl } from '../../../config';
import { ChatSocket } from '../../../socket';
import { authStore } from '../../../apiClient';
import { Chat, Frame } from '../../main/models';
import { callApplyPatches } from '../planDocumentRegistry';

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
  sendMessage: (text: string) => void;
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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlannerChat(): UsePlannerChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const chatIdRef = useRef<string | null>(null);
  const chatModelRef = useRef<string | null>(null);
  // Dedicated socket instance — does NOT share with the main chat screen
  const wsRef = useRef<ChatSocket | null>(null);
  // Poll connection status periodically
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------------------------------------------------------------------------
  // Find or create Planner chat, then connect dedicated socket
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const ws = new ChatSocket();
    wsRef.current = ws;

    async function bootstrap() {
      try {
        // 1. List chats, look for existing Planner chat
        const chats = await apiClient.get<Chat[]>(`${getApiUrl()}/chats`);
        if (cancelled) return;

        let plannerChat: Chat | undefined;
        if (Array.isArray(chats)) {
          plannerChat = chats.find(
            c => c.title === PLANNER_CHAT_TITLE && c.mode === PLANNER_CHAT_MODE,
          );
        }

        // 2. Create if not found
        if (!plannerChat) {
          const created = await apiClient.post<{ id: string }>(
            `${getApiUrl()}/chats`,
            { title: PLANNER_CHAT_TITLE, mode: PLANNER_CHAT_MODE, model: 'glm-4.7', team_id: null },
          );
          if (cancelled) return;
          if (!created?.id) {
            console.error('[usePlannerChat] Failed to create Planner chat');
            return;
          }
          chatIdRef.current = created.id;
          chatModelRef.current = 'glm-4.7';
        } else {
          chatIdRef.current = plannerChat.id;
          chatModelRef.current = plannerChat.model || 'glm-4.7';
        }

        if (cancelled) return;

        // 3. Connect dedicated socket
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
            const frameId = String(frame.id || generateId());

            // Handle text responses (streaming + complete)
            if (type === 'text') {
              const content: string = delta ?? message ?? '';
              if (!content) return;

              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'assistant' && last.id === frameId) {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...last, text: last.text + content };
                  return updated;
                }
                return [...prev, { id: frameId, role: 'assistant', text: content }];
              });
            }

            // Handle client_action (patch_plan_document tool calls)
            if (type === 'client_action' && actions) {
              for (const action of actions) {
                if (action.tool === 'patch_plan_document') {
                  const patches = action.params?.patches ?? [];
                  const summary = action.params?.summary;
                  console.log('[usePlannerChat] Applying patches:', patches, summary);
                  callApplyPatches(patches, summary);
                }
              }
            }
          },
          onDone: () => {},
          onError: (err: any) => {
            console.warn('[usePlannerChat] socket error:', err);
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

  const sendMessage = useCallback((text: string) => {
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

    ws.sendMessage(
      trimmed,
      chatId,
      sessionId,
      msgId,
      [],
      false,
      undefined,
      undefined,
      chatModelRef.current || undefined,
    );
  }, []);

  return { messages, sendMessage, isConnected };
}
