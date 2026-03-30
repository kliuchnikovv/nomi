import { useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient, sendClientToolResult } from '../../../apiClient';
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

export interface UsePlannerChatResult {
  sendMessage: (text: string, options?: { webSearch?: boolean }) => void;
}

export function usePlannerChat(): UsePlannerChatResult {
  const chatIdRef = useRef<string | null>(null);
  const chatModelRef = useRef<string>(DEFAULT_MODEL);
  const chatProviderRef = useRef<string>(DEFAULT_PROVIDER);
  const wsRef = useRef<ChatSocket | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  // Track whether bootstrap has completed
  const bootstrappedRef = useRef(false);
  const bootstrapPromiseRef = useRef<Promise<void> | null>(null);

  // ---------------------------------------------------------------------------
  // Bootstrap — run once, resolves when chatId is known
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [savedModel, savedProvider] = await Promise.all([
          AsyncStorage.getItem(PLANNER_MODEL_KEY),
          AsyncStorage.getItem(PLANNER_PROVIDER_KEY),
        ]);
        const model = savedModel ?? DEFAULT_MODEL;
        const provider = savedProvider ?? DEFAULT_PROVIDER;
        chatModelRef.current = model;
        chatProviderRef.current = provider;

        const chats = await apiClient.get<Chat[]>(`${getApiUrl()}/chats`);
        if (cancelled) return;

        let plannerChat: Chat | undefined;
        if (Array.isArray(chats)) {
          plannerChat = chats.find(
            c => c.title === PLANNER_CHAT_TITLE && c.mode === PLANNER_CHAT_MODE,
          );
        }

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
          if (plannerChat.model !== model) {
            try {
              await apiClient.put(`${getApiUrl()}/chats/${plannerChat.id}`, { model });
            } catch {
              // Non-critical
            }
          }
          chatIdRef.current = plannerChat.id;
        }

        if (!cancelled) {
          bootstrappedRef.current = true;
        }
      } catch (err) {
        console.error('[usePlannerChat] bootstrap error:', err);
      }
    }

    bootstrapPromiseRef.current = bootstrap();

    return () => {
      cancelled = true;
      // Close socket if open
      wsRef.current?.close();
      wsRef.current = null;
      bootstrappedRef.current = false;
      chatIdRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // sendMessage — connects on demand, closes after done
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback(
    (text: string, options?: { webSearch?: boolean }) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      async function send() {
        // Wait for bootstrap if still in progress
        if (!bootstrappedRef.current) {
          await bootstrapPromiseRef.current;
        }

        const chatId = chatIdRef.current;
        if (!chatId) {
          console.warn('[usePlannerChat] sendMessage: no chatId after bootstrap');
          return;
        }

        const token = authStore.getToken();
        if (!token) {
          console.warn('[usePlannerChat] sendMessage: no auth token');
          return;
        }

        // Close any previous socket from a prior session
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }

        const ws = new ChatSocket();
        wsRef.current = ws;

        ws.setChannel('chat');
        ws.setChatId(chatId);
        ws.setToken(token);

        ws.setHandlers({
          onMessage: (frame: Frame) => {
            if (!frame.payload) return;
            const { type, message, delta } = frame.payload;
            const msgId: string =
              (frame.payload as any).message_id ?? String(frame.id || generateId());

            if (type === 'text') {
              if (delta) {
                streamingMsgIdRef.current = streamingMsgIdRef.current ?? msgId;
              } else if (message) {
                streamingMsgIdRef.current = null;
              }
            }

            // client_action: call_id/tool/method/params are top-level in payload
            if (type === 'client_action') {
              const p = frame.payload as any;
              const { call_id: callId, tool, params: actionParams } = p;
              if (tool === 'patch_plan_document') {
                const patches = actionParams?.patches ?? [];
                const summary = actionParams?.summary;
                callApplyPatches(patches, summary);
                if (callId) {
                  sendClientToolResult(currentSessionId, callId, 'ok').catch(
                    err => console.warn('[usePlannerChat] sendClientToolResult error:', err),
                  );
                }
              }
            }
          },
          onDone: () => {
            streamingMsgIdRef.current = null;
            // Close the socket — session complete, no persistent connection needed
            wsRef.current?.close();
            wsRef.current = null;
          },
          onError: (err: any) => {
            console.warn('[usePlannerChat] socket error:', err);
            streamingMsgIdRef.current = null;
            wsRef.current?.close();
            wsRef.current = null;
          },
        });

        const msgId = generateId();
        const sessionId = `planner_${Date.now()}`;
        // Keep sessionId in scope for client_action round-trip
        const currentSessionId = sessionId;

        // connectOnce() — no shouldReconnect, so if server closes the connection
        // (e.g. due to eviction by another client) we don't enter a reconnect loop.
        ws.connectOnce();
        ws.sendMessage(
          trimmed,
          chatId,
          currentSessionId,
          msgId,
          [],
          options?.webSearch ?? false,
          undefined,
          undefined,
          chatModelRef.current,
          chatProviderRef.current,
          undefined,   // tools
          undefined,   // userId
          undefined,   // endpoint
          undefined,   // authToken
          { type: 'planner' },  // command.type — routes to PlannerAgent on backend (factory.py line 517)
        );
      }

      send().catch(err => console.error('[usePlannerChat] send error:', err));
    },
    [],
  );

  return { sendMessage };
}
