import { Frame } from './screens/main/models';
import { useChatStore } from './store/chatStore';

// Helper if uuid package is not available or problematic in RN without polyfills
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

type Handlers = {
    // onToken?: (frame: Frame) => void;
    onMessage?: (frame: Frame) => void; // For full messages
    onDone?: (frame: Frame) => void;
    onError?: (err: any) => void;
    // onAnnounce?: (chatId: string) => void;
    onUnauthorized?: () => Promise<boolean> | boolean; // return true if token refreshed
    onMeta?: (meta: Frame) => void;
    onPing?: (ping: Frame) => Promise<boolean> | boolean;
    onTools?: (frame: Frame) => void; // For tools list
};

export class ChatSocket {
    private ws: any | null = null;
    private readonly rootUrl: string;
    private readonly getToken: () => string | null;
    private readonly getChatId: () => string | null;
    private readonly getMessageId: () => string | null;
    private readonly getModel: () => string | null;
    private readonly getContext: () => string | null;
    private readonly getMode?: () => 'agent' | 'team' | null | undefined;
    private readonly getCommand?: () => any;
    private handlers: Handlers = {};
    // Removed internal outbox in favor of store
    // private outbox: any[] = [];
    private idleTimer: any = null;
    private idleTimeoutMs = 5 * 60 * 1000; // 5 minutes
    private sentCommandFrame = false;

    constructor(
        rootUrl: string,
        getToken: () => string | null,
        getChatId: () => string | null,
        getMessageId: () => string | null,
        getModel: () => string | null,
        getContext: () => string | null,
        getMode?: () => 'agent' | 'team' | null | undefined,
        getCommand?: () => any,
    ) {
        this.rootUrl = rootUrl;
        this.getToken = getToken;
        this.getChatId = getChatId;
        this.getMessageId = getMessageId;
        this.getModel = getModel;
        this.getContext = getContext;
        this.getMode = getMode;
        this.getCommand = getCommand;
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
            console.log("WS open blocked: missing token", token);
            return;
        }

        if (this.ws) {
            try {
                this.ws.close();
            } catch { }
            this.ws = null;
        }

        const qs = new URLSearchParams();
        if (chatId) qs.append('chat_id', chatId);
        if (token) qs.append('token', token);
        if (initialSessionId) qs.append('sessionId', initialSessionId);

        // Add model parameter if selected
        const model = this.getModel();
        if (model) qs.append('model', model);

        // Add context parameter
        const context = this.getContext();
        if (context) {
             qs.append('source', context);
             // Special handling for user channel
             if (context === 'user_channel') {
                 qs.append('channel', 'user');
             }
        }

        const mode = this.getMode?.() || 'agent';
        if (mode) qs.append('mode', mode);

        // Add user's timezone information
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            if (tz) {
                qs.append('timezone', tz);
                console.log('[Socket] Detected timezone:', tz);
            }

            // Fallback: Send raw offset (in minutes)
            const offset = new Date().getTimezoneOffset();
            qs.append('timezone_offset', String(offset));
            console.log('[Socket] Detected timezone offset:', offset);
        } catch (e) {
            console.warn('[Socket] Failed to get timezone info', e);
        }

        const command = this.getCommand?.();
        if (command) {
            try {
                const serialized = typeof command === 'string' ? command : JSON.stringify(command);
                qs.append('command', serialized);
            } catch (err) {
                console.warn('Failed to serialize command for query', err);
            }
        }

        const httpUrl = `${this.rootUrl}/chat/ws?${qs.toString()}`;
        const wsUrl = httpUrl.startsWith('https://')
            ? httpUrl.replace('https://', 'wss://')
            : httpUrl.replace('http://', 'ws://');

        console.log('Attempting to connect to WebSocket:', wsUrl); // Add this log
        // console.log('Chat ID:', chatId); // Add this log
        console.log('Token (first 10 chars):', token ? token.substring(0, 10) + '...' : 'null'); // Add this log

        let retried = false;
        try {
            const ws: any = new (WebSocket as any)(
                wsUrl,
                [], // Explicitly pass an empty array for protocols
                token
                    ? { headers: { Authorization: `Bearer ${token}` } }
                    : undefined,
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

                // Handle potentially concatenated JSON messages (can happen when phone is locked/unlocked)
                // Split on }{ pattern to separate multiple JSON objects
                // Handle concatenated JSON messages using bracket counting
                const jsonStrings: string[] = [];
                let depth = 0;
                let inString = false;
                let start = 0;

                for (let i = 0; i < raw.length; i++) {
                    const char = raw[i];
                    if (inString) {
                        if (char === '"') {
                            let backslashes = 0;
                            let j = i - 1;
                            while (j >= start && raw[j] === '\\') {
                                backslashes++;
                                j--;
                            }
                            if (backslashes % 2 === 0) inString = false;
                        }
                    } else {
                        if (char === '"') {
                            inString = true;
                        } else if (char === '{') {
                            // If starting a top-level object, ensure start points here? 
                            // Actually start is updated after push.
                            // If raw starts with whitespace, start handles it via skip logic below.
                            depth++;
                        } else if (char === '}') {
                            depth--;
                            if (depth === 0) {
                                jsonStrings.push(raw.substring(start, i + 1));
                                start = i + 1;
                                // Skip whitespace
                                while (start < raw.length && /\s/.test(raw[start])) start++;
                                i = start - 1;
                            }
                        }
                    }
                }

                for (const jsonStr of jsonStrings) {
                    const trimmed = jsonStr.trim();
                    if (!trimmed) continue;

                    try {
                        const rawJson = JSON.parse(trimmed);
                        if (!rawJson) continue;

                        const frame = rawJson as Frame;

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
                                if (data?.code !== 401 || retried) {
                                    // Extract error message from various possible locations
                                    let errorMessage = 'Ошибка соединения';

                                    // Check frame.error (preferred source from backend)
                                    if (frame.error) {
                                        if (typeof frame.error === 'string') {
                                            errorMessage = frame.error;
                                        } else if (frame.error.message && typeof frame.error.message === 'string') {
                                            errorMessage = frame.error.message;
                                        }
                                    }
                                    // Fallback to legacy checks on payload (data)
                                    else if (data && typeof data === 'object') {
                                        if (data.error) {
                                            errorMessage = typeof data.error === 'string'
                                                ? data.error
                                                : data.error.message || JSON.stringify(data.error);
                                        } else if (data.message) {
                                            errorMessage = data.message;
                                        }
                                    }

                                    // Provide user-friendly message for backend connection errors
                                    if (errorMessage.includes('dial tcp') || errorMessage.includes('connection refused')) {
                                        errorMessage = 'Не удалось подключиться к AI сервису. Попробуйте позже.';
                                    }

                                    this.handlers.onError?.({ ...frame, message: errorMessage });
                                    break;
                                }

                                retried = true;
                                const ok = await (this.handlers.onUnauthorized?.() ?? false);
                                if (!ok) {
                                    break;
                                }

                                try { ws.close(); } catch { }
                                this.open();

                                break;
                            case 'message':
                                if (kind === 'data') {
                                    this.handlers.onMessage?.(frame);
                                } else {
                                    this.handlers.onMeta?.(frame);
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
                // WebSocket errors are usually connection drops (phone locked, network change)
                // We just log them - actual error handling with codes happens in onclose
                console.log('WebSocket onerror event (connection issue):', e);
                // Don't call onError here - it shows confusing messages to users
                // this.handlers.onError?.(e);
            };

            ws.onclose = async (e: any) => {
                console.log('WebSocket onclose event:', e.code, e.reason); // Log code and reason
                if (this.ws === ws) this.ws = null;
                const code = e?.code;
                const unauthorized = code === 4401 || code === 4001 || code === 1008;

                // Handle unauthorized
                if (unauthorized && !retried) {
                    retried = true;
                    const ok = await (this.handlers.onUnauthorized?.() ?? false);
                    if (ok) {
                        this.open();
                        return;
                    }
                }

                // For normal disconnects (phone locked, network change, etc.), 
                // don't show error - will reconnect on next user action
                const normalDisconnect = code === 1006 || code === 1001 || code === 1000;
                if (normalDisconnect) {
                    console.log('Normal disconnect, will reconnect on next action');
                    // Don't call onError for normal disconnects
                    return;
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
            chat_id: chatID,
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

    private enqueueCommandFrame(chatID?: string | null) {
        const mode = this.getMode?.() || 'agent';
        const command = this.getCommand?.();
        if (!command || mode !== 'team') return;
        if (this.sentCommandFrame) return;

        const payloadValue = command;
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

    sendStop() {
        const chatID = this.getChatId();
        const frame = {
            id: 0,
            kind: 'meta',
            op: 'stop',
            chat_id: chatID,
            payload: {},
        };

        if (this.isReady()) {
            try {
                console.log('Sending stop frame');
                this.ws.send(JSON.stringify(frame));
            } catch (err) {
                console.error('Failed to send stop frame:', err);
            }
        }
        // Close the connection to ensure agent stops
        this.close();
    }

    changeModel(newModel: string) {
        if (!this.isReady()) {
            // console.warn('Cannot change model: WebSocket not ready');
            return;
        }

        const chatID = this.getChatId();
        const frame = {
            id: 0,
            kind: 'meta',
            op: 'model',
            chat_id: chatID,
            payload: {
                model: newModel,
            },
        };

        try {
            console.log('Changing model to:', newModel);
            this.ws.send(JSON.stringify(frame));
            this.touchActivity();
        } catch (err) {
            console.error('Failed to send model change frame:', err);
        }
    }

    close() {
        try {
            this.ws?.close();
        } catch { }

        this.ws = null;
        this.sentCommandFrame = false;

        if (this.idleTimer) {
            try {
                clearTimeout(this.idleTimer);
            } catch { }
            this.idleTimer = null;
        }
    }
}
