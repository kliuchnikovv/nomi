import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient, sendClientToolResult } from '../../../apiClient';
import { getApiUrl } from '../../../config';
import { socket } from '../../../socket';
import { authStore } from '../../../apiClient';
import { useChatStore } from '../../../store/chatStore';
import { Chat, Message } from '../../main/models';
import { callApplyPatches } from '../planDocumentRegistry';
import {
  PLANNER_MODEL_KEY,
  PLANNER_PROVIDER_KEY,
} from '../../settings/screen';
import { subscribePlannerAction } from '../../../store/plannerActionStore';
import { subscribeChatError } from '../../../store/chatErrorStore';
import { subscribeGenerationDone } from '../../../store/generationDoneStore';

// ---------------------------------------------------------------------------
// Constants & Stable defaults
// ---------------------------------------------------------------------------

const STABLE_EMPTY_ARRAY: any[] = [];
const PLANNER_CHAT_TITLE = 'Planner';
const PLANNER_CHAT_MODE = 'agent';
const DEFAULT_MODEL = 'glm-4.7';
const DEFAULT_PROVIDER = 'z.ai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isStreaming?: boolean;
  askUser?: { callId: string; options: string[] };
  created_at?: number;
  metadata?: Record<string, any>;
}

/** Alias kept for backward compat with PlannerChatPanel */
export type PlannerMessage = ChatMessage;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function normalizeToMs(timestamp: number | undefined): number {
  if (!timestamp) return 0;
  // Threshold 4,000,000,000 (year 2097) distinguishes seconds from ms
  if (timestamp < 4000000000) {
    return timestamp * 1000;
  }
  if (timestamp > 10000000000000) {
    // Microseconds or nanoseconds: reduce to ms
    return timestamp / 1000;
  }
  return timestamp;
}

// Date filtering logic removed: each day now has its own chat history.

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------

export interface UsePlannerChatResult {
  messages: ChatMessage[];
  isConnected: boolean;
  isThinking: boolean;
  sendMessage: (text: string, options?: { webSearch?: boolean; context?: string }) => void;
  replyToAskUser: (callId: string, answer: string) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlannerChat(date: string): UsePlannerChatResult {
  const [chatId, setChatId] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const chatModelRef = useRef<string>(DEFAULT_MODEL);
  const chatProviderRef = useRef<string>(DEFAULT_PROVIDER);
  const bootstrappedRef = useRef(false);

  // Subscribe to the store messages for THIS planner chat
  const storeMessages = useChatStore(state =>
    chatId ? (state.chats[chatId] ?? STABLE_EMPTY_ARRAY) : STABLE_EMPTY_ARRAY,
  );

  // Convert store Message[] → ChatMessage[] for display
  const messages: ChatMessage[] = useMemo(() => {
    // 2. Convert to UI format
    const allStoreMessages: ChatMessage[] = storeMessages.map((m) => {
      // Aggregate text from all content_parts (text, reasoning, member_response)
      let text = m.text === " " ? "" : (m.text ?? "");
      // Strip the invisible plan context block that was appended for the AI backend
      const ctxIdx = text.indexOf('\n\n[Current plan:');
      if (ctxIdx !== -1) {
        text = text.slice(0, ctxIdx);
      }

      const partsText = (m.content_parts || [])
        .filter(p => p.type === 'text' || (p as any).type === 'member_response' || p.type === 'reasoning')
        .map(p => {
          if (p.type === 'text') return p.text;
          if ((p as any).type === 'member_response') return (p as any).text;
          if (p.type === 'reasoning') return `\n> Thinking: ${p.reasoning}\n`;
          return '';
        })
        .join('');

      if (partsText && partsText.length > text.length) {
        text = partsText;
      }

      return {
        id: m.id,
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        text,
        isStreaming: false, // Default, will set for last one below
        created_at: m.created_at,
        metadata: m.metadata,
      };
    });

    // 3. Find unique local messages (not yet in store)
    const storeIds = new Set(allStoreMessages.map(m => m.id));
    const pendingLocal = localMessages.filter(m => !storeIds.has(m.id));

    // 4. Combine and Sort chronologically
    const combined = [...allStoreMessages, ...pendingLocal];
    combined.sort((a, b) => {
      const timeA = normalizeToMs(a.created_at);
      const timeB = normalizeToMs(b.created_at);
      return timeA - timeB;
    });

    // 5. Final pass for streaming cursor on absolute last assistant message
    if (isThinking && combined.length > 0) {
      const lastMsg = combined[combined.length - 1];
      if (lastMsg.role === 'assistant') {
        lastMsg.isStreaming = true;
      }
    }

    return combined;
  }, [storeMessages, localMessages, isThinking]);

  // ---------------------------------------------------------------------------
  // Bootstrap — find or create the "Planner" chat & load HISTORY
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    // Reset per-day state immediately when date changes
    setChatId(null);
    setLocalMessages([]);
    setIsThinking(false);
    setIsConnected(false);
    bootstrappedRef.current = false;

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

        const expectedTitle = `Planner: ${date}`;
        let plannerChat = chats.find(
          c => c.title === expectedTitle && c.mode === PLANNER_CHAT_MODE,
        );

        let resolvedId: string;
        if (!plannerChat) {
          const created = await apiClient.post<{ id: string }>(
            `${getApiUrl()}/chats`,
            { title: expectedTitle, mode: PLANNER_CHAT_MODE, model, team_id: null },
          );
          if (cancelled || !created?.id) return;
          resolvedId = created.id;
        } else {
          resolvedId = plannerChat.id;
        }

        if (cancelled) return;

        // LOAD HISTORY — merge to avoid wiping any in-flight streamed messages
        const history = await apiClient.get<Message[]>(`${getApiUrl()}/chats/${resolvedId}/messages`);
        if (!cancelled && history) {
          const existing = useChatStore.getState().chats[resolvedId];
          if (!existing || existing.length === 0) {
            useChatStore.getState().setMessages(resolvedId, history);
          } else {
            useChatStore.getState().mergeMessages(resolvedId, history);
          }
        }

        setChatId(resolvedId);
        bootstrappedRef.current = true;
        setIsConnected(true);
      } catch (err) {
        console.error('[usePlannerChat] bootstrap error:', err);
      }
    }

    bootstrap();
    return () => { cancelled = true; };
  }, [date]);

  // ---------------------------------------------------------------------------
  // Event Store Subscriptions (replaces socket.setHandlers)
  // ---------------------------------------------------------------------------

  // Effect 1: Planner client_actions (patch_plan_document, ask_user)
  useEffect(() => {
    if (!chatId) return;
    return subscribePlannerAction(chatId, (p) => {
      if (p.type === 'client_action' && p.tool === 'patch_plan_document') {
        const { call_id: callId, params: actionParams } = p;
        const patches = actionParams?.patches ?? [];
        const summary = actionParams?.summary;
        console.log('[usePlannerChat] patch_plan_document call_id:', callId, 'ops:', patches.map((x: any) => x.op), 'summary:', summary);
        // Apply patches in try-catch so a patch error never blocks the tool result
        try {
          callApplyPatches(patches, summary);
        } catch (e) {
          console.error('[usePlannerChat] callApplyPatches error:', e);
        }
        // Always send result — backend waits for this before continuing
        if (callId) {
          sendClientToolResult(chatId, callId, 'ok').catch((e) => {
            console.error('[usePlannerChat] sendClientToolResult failed:', e);
          });
        }
      }

      if (p.type === 'client_action' && p.tool === 'ask_user') {
        const { call_id: callId, params: actionParams } = p;
        const question: string = actionParams?.question ?? '';
        const options: string[] = actionParams?.options ?? [];
        setLocalMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'assistant',
            text: question,
            askUser: { callId, options },
            created_at: Date.now(),
          },
        ]);
      }
    });
  }, [chatId]);

  // Effect 2: Generation done — clear thinking indicator
  useEffect(() => {
    if (!chatId) return;
    return subscribeGenerationDone((doneChatId) => {
      if (doneChatId === chatId) {
        setIsThinking(false);
      }
    });
  }, [chatId]);

  // Effect 3: Socket error — clear thinking indicator
  useEffect(() => {
    if (!chatId) return;
    return subscribeChatError(chatId, () => {
      setIsThinking(false);
    });
  }, [chatId]);

  // ---------------------------------------------------------------------------
  // sendMessage
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback(
    (text: string, options?: { webSearch?: boolean; context?: string }) => {
      const trimmed = text.trim();
      if (!trimmed || !chatId) return;

      const userMsgId = generateId();
      // Store only the visible text locally; context is invisible to the user
      setLocalMessages(prev => [...prev, { id: userMsgId, role: 'user', text: trimmed, created_at: Date.now() }]);
      setIsThinking(true);

      const token = authStore.getToken();
      if (!token) return;

      socket.setChannel('chat');
      socket.setChatId(chatId);
      socket.setToken(token);

      if (!socket.isReady()) {
        socket.connect();
      }

      // Append invisible plan context to the actual message sent to the backend
      const payload = options?.context ? `${trimmed}\n\n${options.context}` : trimmed;

      socket.sendMessage(
        payload,
        chatId,
        `planner_${Date.now()}`,
        userMsgId,
        undefined, // 5th: attachmentIDs
        options?.webSearch ?? false, // 6th: webSearch
        undefined, // 7th: thinking
        'user', // 8th: role
        chatModelRef.current, // 9th: model
        chatProviderRef.current, // 10th: provider
        undefined, // 11th: tools
        undefined, // 12th: userId
        undefined, // 13th: endpoint
        undefined, // 14th: authToken
        { type: 'planner', date: date }, // 15th: command
      );
    },
    [chatId, date],
  );

  // ---------------------------------------------------------------------------
  // replyToAskUser
  // ---------------------------------------------------------------------------

  const replyToAskUser = useCallback(
    (callId: string, answer: string) => {
      const trimmed = answer.trim();
      if (!trimmed || !chatId) return;

      const userMsgId = generateId();
      setLocalMessages(prev => [
        // Remove the ask_user prompt (it was answered) then append the user reply
        ...prev.filter(m => m.askUser?.callId !== callId),
        { id: userMsgId, role: 'user', text: trimmed, created_at: Date.now() },
      ]);
      setIsThinking(true);

      const token = authStore.getToken();
      if (!token) return;

      socket.setChannel('chat');
      socket.setChatId(chatId);
      socket.setToken(token);

      if (!socket.isReady()) {
        socket.connect();
      }

      socket.sendMessage(
        trimmed,
        chatId,
        `planner_reply_${Date.now()}`,
        userMsgId,
        undefined, // 5th: attachmentIDs
        false, // 6th: webSearch
        undefined,
        'user',
        chatModelRef.current,
        chatProviderRef.current,
        undefined,
        undefined,
        undefined,
        undefined,
        { type: 'planner', date: date },
      );

      sendClientToolResult(chatId, callId, answer).catch(() => { });
    },
    [chatId, date],
  );

  return { messages, isConnected, isThinking, sendMessage, replyToAskUser };
}
