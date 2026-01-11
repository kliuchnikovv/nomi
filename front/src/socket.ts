import { Frame } from './screens/main/models';
import { useChatStore } from './store/chatStore';
import { getApiUrl } from './config';

// Helper if uuid package is not available or problematic in RN without polyfills
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

type Handlers = {
    onDone?: (frame: Frame) => void;
    onError?: (err: any) => void;
    onUnauthorized?: () => Promise<boolean> | boolean; // return true if token refreshed
    onPing?: (ping: Frame) => Promise<boolean> | boolean;
    onTools?: (frame: Frame) => void; // For tools list
    // Legacy handlers that might still be useful
    onMessage?: (frame: Frame) => void;
    onMeta?: (meta: Frame) => void;
};

export class ChatSocket {
    private ws: any | null = null;
    private token: string | null = null;
    private handlers: Handlers = {};
    // Removed internal outbox in favor of store
    // private outbox: any[] = [];
    private idleTimer: any = null;
    private idleTimeoutMs = 5 * 60 * 1000; // 5 minutes
    // private sentCommandFrame = false; // Command frames are per-message/chat context now?
    // Actually, team commands are sent once per session usually. But in a global socket, we might switch contexts.
    // For now, let's keep it simple: we send commands when sending a message if needed, or rely on the backend session.

    constructor() {}

    setToken(token: string | null) {
        this.token = token;
        // If we have a token and not connected, maybe we should connect?
        // But let's leave explicit connect() call to the consumer (App/AuthContext).
    }

    setHandlers(h: Handlers) {
        this.handlers = h || {};
    }

    setIdleTimeout(ms: number) {
        this.idleTimeoutMs = ms;
    }

    private scheduleIdleClose() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        this.idleTimer = setTimeout(() => {
            this.close();
        }, this.idleTimeoutMs);
    }

    private touchActivity() {
        this.scheduleIdleClose();
    }

    isReady(): boolean {
        return !!this.ws && this.ws.readyState === 1;
    }

    // Process Persistent Outbox
    public async processOutbox() {
        if (!this.isReady()) {
            console.log('[Socket] Cannot process outbox: Socket not ready');
            return;
        }

        const store = useChatStore.getState();
        const outbox = store.outbox;

        if (outbox.length === 0) return;

        console.log(`[Socket] Processing outbox: ${outbox.length} messages`);

        for (const item of outbox) {
            try {
                this.ws.send(JSON.stringify(item.payload));
                // We don't remove from outbox here; we wait for ACK
                // But for reliability, maybe we should remove if send throws? No, retry later.
            } catch (e) {
                console.warn('[Socket] Failed to send outbox item', e);
                // Stop processing if connection seems broken
                break;
            }
        }
    }

    public isConnected() {
        return this.isReady();
    }

    open(initialQ?: string, initialSessionId?: string) {
        const chatId = this.getChatId();
        const token = this.getToken();
        // messageId is per-message and should not be required to open a long-lived socket
        // const messageId = this.getMessageId();
        if (!token) {
            console.log("WS open blocked: missing token");
            return;
        }

        if (this.ws) {
            try {
                this.ws.close();
            } catch { }
            this.ws = null;
        }

        const rootUrl = getApiUrl();
        const qs = new URLSearchParams();
        qs.append('token', token);
        qs.append('channel', 'user'); // Global user channel

        // Add user's timezone information
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            if (tz) {
                qs.append('timezone', tz);
            }
            const offset = new Date().getTimezoneOffset();
            qs.append('timezone_offset', String(offset));
        } catch (e) {
            console.warn('[Socket] Failed to get timezone info', e);
        }

        const httpUrl = `${rootUrl}/chat/ws?${qs.toString()}`;
        const wsUrl = httpUrl.startsWith('https://')
            ? httpUrl.replace('https://', 'wss://')
            : httpUrl.replace('http://', 'ws://');

        console.log('Attempting to connect to Global WebSocket:', wsUrl);

        let retried = false;

        try {
            const ws: any = new (WebSocket as any)(
                wsUrl,
                [],
                token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
            );
            this.ws = ws;

            ws.onopen = () => {
                this.touchActivity();
                this.sentCommandFrame = false;
                this.enqueueCommandFrame();

                // Process persistent outbox instead of local queue
                this.processOutbox();
            };

            ws.onmessage = async (e: any) => {
                this.touchActivity();
                const raw = typeof e.data === 'string' ? e.data : '';
                const jsonStrings = this.splitJsonMessages(raw);

                for (const jsonStr of jsonStrings) {
                    const trimmed = jsonStr.trim();
                    if (!trimmed) continue;

                    try {
                        const rawJson = JSON.parse(trimmed);
                        if (!rawJson) continue;

                        const frame = rawJson as Frame;
                        const op = frame.op;

                        // Handle global routing
                        if (op === 'message' || op === 'tools' || op === 'model' || op === 'done') {
                            const chatId = frame.chat_id;
                            if (chatId) {
                                // 1. Update Global Store
                                useChatStore.getState().addMessage(chatId, frame.payload);

                                // 2. Notify Listeners (legacy handlers for specific effects)
                                // Only call legacy handlers if they are still relevant.
                                // ChatContext might still want to know about completion or errors.
                                if (op === 'message' && frame.kind === 'data') {
                                    this.handlers.onMessage?.(frame);
                                } else if (op === 'done') {
                                    this.handlers.onDone?.(frame);
                                } else {
                                    this.handlers.onMeta?.(frame);
                                }
                            }
                        }

                        const kind = frame.kind;
                        const data = frame.payload;
                        const operation = frame.op;

                        // Check for ACK
                        if (operation === 'ack' && data?.message_id) {
                            console.log(`[Socket] Received ACK for message: ${data.message_id}`);
                            const store = useChatStore.getState();
                            store.removeFromOutbox(data.message_id);
                            store.updateMessageStatus(data.message_id, 'sent');

                            // Continue processing remaining outbox if any (to ensure order?)
                            // Actually processOutbox loops through all.
                        }

                        // console.log(`${operation} with kind ${kind}`, frame);
                        switch (operation) {
                            case 'ping':
                                this.handlers.onPing?.(frame);
                                break;
                            case 'error':
                                if (frame.payload?.code === 401 && !retried) {
                                    retried = true;
                                    const ok = await (this.handlers.onUnauthorized?.() ?? false);
                                    if (ok) {
                                        try { ws.close(); } catch { }
                                        this.open();
                                    }
                                } else {
                                    this.handlers.onError?.(frame);
                                }

                                break;
                            case 'done':
                                this.handlers.onDone?.(frame);
                                break;
                            case 'model':
                                break;
                            case 'tools':
                                this.handlers.onTools?.(frame);
                                break;
                            case 'signal': // Add support for signal operations
                                this.handlers.onMessage?.(frame);
                                break;
                            default:
                                if (operation !== 'ack') {
                                    console.warn(`Unknown message op: ${operation}`, rawJson);
                                }
                                break;
                        }
                    } catch (err) {
                        console.warn('Failed to parse WS message:', err, trimmed);
                    }
                }
            };

            ws.onerror = (e: any) => {
                console.log('WebSocket onerror event:', e);
            };

            ws.onclose = async (e: any) => {
                console.log('WebSocket onclose event:', e.code, e.reason);
                if (this.ws === ws) this.ws = null;
                const code = e?.code;

                // Unauthorized
                if ((code === 4401 || code === 4001 || code === 1008) && !retried) {
                    retried = true;
                    const ok = await (this.handlers.onUnauthorized?.() ?? false);
                    if (ok) {
                        this.open();
                    }
                }
            };

        } catch (e) {
            this.handlers.onError?.(e);
        }
    }

    sendMessage(message: string, sessionId: string, messageID?: string, attachmentIDs?: string[], webSearch?: boolean, thinking?: string, role: string = 'user') {
        const chatID = this.getChatId();
        const model = this.getModel();

        if (!chatID) return;

        // If no messageID provided, generate one locally (Socket-First approach)
        const finalMessageID = messageID || generateUUID();

        // Optimistic Update: Store message immediately in ChatStore
        const store = useChatStore.getState();
        // Construct partial message for store
        const timestamp = Date.now();
        // Assuming we have access to user ID or it's "user"
        // Wait, socket doesn't know sender ID cleanly without props.
        // But the store.addMessage requires a full Message object.
        // We will delegate the store.addMessage to the caller (ChatContext)
        // OR we can do it here if we pass enough info.
        // For 'outbox', we definitely need to store it here.

        this.enqueueCommandFrame(chatID);

        const msg = {
            id: 0,
            kind: 'data',
            chat_id: chatId,
            op: 'message',
            payload: {
                message_id: finalMessageID,
                message: message,
                role: role, // Use provided role
                model: model, // Include user's model choice
                sessionId: sessionId, // Keep sending for server-side logging if needed
                attachment_ids: attachmentIDs,
                web_search: webSearch,
                thinking: thinking,
                // Add timestamp to payload? Protocol doesn't strictly require it for processing but good for sync?
            },
        };

        // Add to persistent outbox
        // We need a proper Message object for the store's outbox visualization if we want to show it?
        // Actually, the Store's outbox structure expects { message: Message, payload: any }.
        // Constructing a Message object here might be redundant if ChatContext already does it.
        // Let's assume ChatContext calls this.
        // But wait, the requirement says "Socket-First".
        // The Plan says: "Update sendMessage to: Create local UUID, Save to store, AddToOutbox, Try to send".

        // To construct a valid Message object we need 'sender' and 'created_at'.
        // We can pass them or let ChatContext handle the UI part and Socket handle the Transport part.
        // However, `outbox` is now in `chatStore`.
        // Let's make `sendMessage` accept the full `Message` object optionally?
        // Or just keep the signature and let ChatContext add to store `messages`,
        // while `socket` adds to store `outbox`.

        // Let's create a temporary Message object for the outbox reference
        // Note: The outbox needs the Message object primarily if we want to display it or retry it with UI context.
        // But `processOutbox` only needs `payload`.
        // The requirement "If send message without internet, it appears in chat" implies the store has it in `messages`.

        // Let's update the Outbox item structure in Store to be just payload if we don't strictly need the Message object there,
        // OR we construct a minimal one.
        // But the store definition I wrote has `message: Message`.

        // Let's fetch the message from the store if it exists? No, it might not exist yet if we do it here.

        // Better approach:
        // ChatContext constructs the Message, adds to Store (messages), then calls Socket.sendMessage.
        // Socket.sendMessage adds to Store (outbox) and tries to send.
        // But Socket.sendMessage signature doesn't take the Message object.

        // I will modify ChatContext to pass the message object OR
        // I will construct a dummy message wrapper for the outbox entry if needed,
        // relying on ChatContext to have populated the main messages list.
        // Actually, for `outbox` persistence, we need the `payload`.
        // The `message` field in outbox was intended for UI "retrying..." indicators perhaps?

        // Let's simplify:
        // 1. ChatContext creates Message (pending), adds to store.messages.
        // 2. ChatContext calls socket.sendMessage with messageID.
        // 3. Socket adds { message: {id: messageID} as Message, payload: msg } to outbox.
        // 4. Socket tries to send.

        // We cast to Message to satisfy TS for now, or fetch from store messages if possible.
        const dummyMessage = { id: finalMessageID } as any;

        store.addToOutbox(dummyMessage, msg);

        if (!this.ws) {
            this.open(message, sessionId);
            return;
        }

        if (this.isReady()) {
            try {
                this.ws.send(JSON.stringify(msg));
                this.touchActivity();
            } catch {
                // Already in outbox
            }
        }

        // Return the ID so context knows it
        return finalMessageID;
    }

    // Send a command or tools frame
    sendMeta(chatId: string, op: string, payload: any) {
        const frame = {
            id: 0,
            kind: 'meta',
            op: 'tools',
            chat_id: chatID || this.getChatId(),
            payload: {
                command: payloadValue,
                team: payloadValue,
                team_desc: payloadValue,
            },
        };
        this.sentCommandFrame = true;
        // Tools frame shouldn't necessarily go to outbox in the same way as user messages,
        // but for team mode init it might be needed.
        // For now, let's allow it to be sent directly on open.
        if (this.isReady()) {
             try { this.ws.send(JSON.stringify(frame)); } catch {}
        }
    }

    sendTools(tools: any[]) {
        const chatID = this.getChatId();
        const frame = {
            id: 0,
            kind: 'meta',
            op: 'tools',
            chat_id: chatID,
            payload: {
                tools: tools,
            },
        };

        if (this.isReady()) {
            try {
                // console.log('Sending tools frame:', JSON.stringify(frame));
                this.ws.send(JSON.stringify(frame));
            } catch (err) {
                console.error('Failed to send tools frame:', err);
            }
        }
        // Tools usually don't need persistent outbox for offline messaging logic,
        // they are session initialization.
    }

    changeModel(chatId: string, newModel: string) {
        this.sendMeta(chatId, 'model', { model: newModel });
    }

    sendStop(chatId: string) {
        this.sendMeta(chatId, 'stop', {});
    }

    close() {
        try {
            this.ws?.close();
        } catch { }
        this.ws = null;
        this.outbox = [];
        this.sentCommandFrame = false;

        if (this.idleTimer) {
            try {
                clearTimeout(this.idleTimer);
            } catch { }
            this.idleTimer = null;
        }
    }
}

export const socket = new ChatSocket();
