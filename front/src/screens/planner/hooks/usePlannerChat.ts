/**
 * usePlannerChat — manages a dedicated "Planner" chat session for AI interaction
 * from the planner screen.
 *
 * Strategy:
 *  1. On mount, list all chats and look for one with title === 'Planner' and mode === 'agent'.
 *  2. If not found, create it via POST /api/chats.
 *  3. Connect the global ChatSocket to that chat's room.
 *  4. Subscribe to incoming frames and expose a sendMessage helper.
 *
 * The hook reuses the existing `socket` singleton (same as ChatProvider) but
 * does NOT depend on ChatProvider/MainProvider being mounted — it is self-contained
 * so it can be used from PlannerScreen without wrapping the whole app.
 *
 * NOTE: Because the global `socket` singleton is shared with the rest of the app,
 * calling this hook while a regular ChatScreen is active will hijack the socket
 * connection. For a future improvement, consider using a separate ChatSocket
 * instance here (TODO: dedicate a socket instance per screen).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../../../apiClient';
import { getApiUrl } from '../../../config';
import { socket } from '../../../socket';
import { authStore } from '../../../apiClient';
import { Chat } from '../../main/models';
import { Frame } from '../../main/models';

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
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
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

  // Buffer for streaming text accumulation per message id
  const streamBufferRef = useRef<Record<string, string>>({});

  // ---------------------------------------------------------------------------
  // Find or create Planner chat
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        // 1. List chats
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
            {
              title: PLANNER_CHAT_TITLE,
              mode: PLANNER_CHAT_MODE,
              model: 'gpt-5-nano',
              team_id: null,
            },
          );
          if (cancelled) return;
          if (!created?.id) {
            console.error('[usePlannerChat] Failed to create Planner chat');
            return;
          }
          chatIdRef.current = created.id;
        } else {
          chatIdRef.current = plannerChat.id;
        }

        // 3. Connect socket to this chat room
        const token = authStore.getToken();
        if (!token) {
          console.warn('[usePlannerChat] No auth token, skipping socket connect');
          return;
        }

        socket.setChannel('chat');
        socket.setChatId(chatIdRef.current);
        socket.setToken(token);

        socket.setHandlers({
          onMessage: (frame: Frame) => {
            if (!frame.payload) return;
            const { type, message, delta } = frame.payload;

            // Only handle text payloads
            if (type !== 'text') return;

            // Streaming delta or complete message
            const content: string = delta ?? message ?? '';
            if (!content) return;

            const frameId = String(frame.id || generateId());

            setMessages(prev => {
              // If last message is an in-progress assistant message with this id, append
              const last = prev[prev.length - 1];
              if (last && last.role === 'assistant' && last.id === frameId) {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...last,
                  text: last.text + content,
                };
                return updated;
              }
              // Otherwise start a new assistant message
              return [
                ...prev,
                { id: frameId, role: 'assistant', text: content },
              ];
            });
          },
          onDone: () => {
            // Nothing extra to do — streaming is complete
          },
          onError: (err: any) => {
            console.warn('[usePlannerChat] socket error:', err);
          },
          onReconnect: () => {
            setIsConnected(true);
          },
        });

        if (!socket.isReady()) {
          socket.connect();
        }

        setIsConnected(socket.isReady());
      } catch (err) {
        console.error('[usePlannerChat] bootstrap error:', err);
      }
    }

    bootstrap();

    // Poll connection state briefly after connect attempt
    const pollTimer = setTimeout(() => {
      setIsConnected(socket.isReady());
    }, 1500);

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
      // Do not close socket on unmount — it's shared with the rest of the app
    };
  }, []);

  // ---------------------------------------------------------------------------
  // sendMessage
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const chatId = chatIdRef.current;
    if (!chatId) {
      console.warn('[usePlannerChat] sendMessage called before chat is ready');
      return;
    }

    const msgId = generateId();
    const sessionId = `planner_${Date.now()}`;

    // Optimistically append user message to local list
    setMessages(prev => [
      ...prev,
      { id: msgId, role: 'user', text: trimmed },
    ]);

    socket.sendMessage(
      trimmed,
      chatId,
      sessionId,
      msgId,
      /* attachmentIDs */ [],
      /* webSearch */ false,
      /* thinking */ undefined,
      /* role */ 'user',
    );
  }, []);

  return { messages, sendMessage, isConnected };
}
