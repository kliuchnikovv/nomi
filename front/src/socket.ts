import { Frame } from './screens/main/models';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

const OUTBOX_KEY = 'chat_outbox';

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
    onAck?: (messageId: string) => void; // New handler for ACKs
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
    private outbox: any[] = [];
    private idleTimer: any = null;
    private idleTimeoutMs = 5 * 60 * 1000; // 5 minutes
    private sentCommandFrame = false;
    private isConnectedToNet: boolean = true;
    private unsubscribeNetInfo: (() => void) | null = null;

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

        // Initialize NetInfo listener
        this.unsubscribeNetInfo = NetInfo.addEventListener((state: NetInfoState) => {
            this.isConnectedToNet = state.isConnected ?? true;
            if (this.isConnectedToNet) {
                this.processOutbox();
            }
        });

        // Load outbox from storage
        this.loadOutbox();
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

    private async loadOutbox() {
        try {
            const stored = await AsyncStorage.getItem(OUTBOX_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    this.outbox = parsed;
                    // Try to send immediately if possible
                    if (this.isReady() || this.isConnectedToNet) {
                        this.processOutbox();
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to load outbox', e);
        }
    }

    private async saveOutbox() {
        try {
            await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(this.outbox));
        } catch (e) {
            console.warn('Failed to save outbox', e);
        }
    }

    private async addToOutbox(msg: any) {
        // Avoid duplicates if possible, though UUID should be unique
        this.outbox.push(msg);
        await this.saveOutbox();
        this.processOutbox();
    }

    private async removeFromOutbox(messageId: string) {
        this.outbox = this.outbox.filter(msg => msg.payload?.message_id !== messageId);
        await this.saveOutbox();
    }

    private async processOutbox() {
        if (!this.isConnectedToNet) return;

        // Ensure socket is open
        if (!this.ws || this.ws.readyState !== 1) {
             // If not ready, open() will trigger onopen which calls processOutbox (via flush logic there)
             // But we need to make sure open() is called.
             // If ws is null, open() will create it.
             this.open();
             return;
        }

        // Send messages
        // We iterate carefully. If send fails, we keep in outbox.
        // We DO NOT remove from outbox here. We wait for ACK.
        for (const msg of this.outbox) {
             try {
                // Check if this is a command frame (internal logic) or user message
                // User messages rely on ACKs. Command frames might not get ACKs?
                // For now, let's treat everything as needing to be sent.
                // If it's a 'tools' frame or 'model' frame, maybe we don't wait for ACK?
                // The requirement is specific to user messages.

                // If it is a message operation, we send and keep in queue.
                // If it is other ops (like tools), we send and maybe remove?
                // For simplicity, let's persist everything until ACK or cleanup.
                // BUT: Backend only ACKs 'message' operations currently.
                // So for non-message operations, we might get stuck?
                // Strategy: Only 'message' ops stay in persistent queue. Others can be transient?
                // Or: We just fire and forget for non-message ops (like 'tools').

                // Let's assume outbox contains mixed types.
                // If op != 'message', send and remove immediately?
                if (msg.op !== 'message') {
                     this.ws.send(JSON.stringify(msg));
                     // Remove from outbox if it's not a message op (fire and forget for now)
                     // Actually, tools frame is sent on connect usually.
                     // Let's filter out non-message frames from persistence if they were added there?
                } else {
                     this.ws.send(JSON.stringify(msg));
                }
             } catch (e) {
                 console.warn('Failed to send from outbox', e);
                 // Stop processing if send fails (connection likely dropped)
                 break;
             }
        }

        // Cleanup non-message frames from outbox to avoid sticking
        const newOutbox = this.outbox.filter(msg => msg.op === 'message');
        if (newOutbox.length !== this.outbox.length) {
            this.outbox = newOutbox;
            await this.saveOutbox();
        }
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
            // If already connecting or open, do nothing?
            // If closing, wait?
            if (this.ws.readyState === 0 || this.ws.readyState === 1) {
                 // Already connecting/connected.
                 return;
            }
            // If closed/closing, cleanup
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

                // Process the persistent outbox
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

                        // console.log(`${operation} with kind ${kind}`, frame);
                        switch (operation) {
                            case 'ping':
                                this.handlers.onPing?.(frame);
                                break;
                            case 'ack':
                                if (data?.message_id) {
                                    await this.removeFromOutbox(data.message_id);
                                    this.handlers.onAck?.(data.message_id);
                                }
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
                                console.warn(`Unknown message op: ${operation}`, rawJson);
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

    async sendMessage(message: string, sessionId: string, messageID?: string, attachmentIDs?: string[], webSearch?: boolean, thinking?: string, role: string = 'user') {
        const chatID = this.getChatId();
        const model = this.getModel();

        if (!chatID) return;

        // Ensure command frame is enqueued if needed (transient, mostly)
        this.enqueueCommandFrame(chatID);

        const msg = {
            id: 0,
            kind: 'data',
            chat_id: chatID,
            op: 'message',
            payload: {
                message_id: messageID,
                message: message,
                role: role, // Use provided role
                model: model, // Include user's model choice
                sessionId: sessionId, // Keep sending for server-side logging if needed
                attachment_ids: attachmentIDs,
                web_search: webSearch,
                thinking: thinking,
            },
        };

        // Add to persistent outbox first
        await this.addToOutbox(msg);

        // Try to open socket if not open (it will process outbox on open)
        if (!this.ws) {
            this.open(message, sessionId);
        }
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
        // Command frames are transient, let's put them in front of outbox in memory,
        // but maybe not persist? Or persist if strict.
        // For now, let's not break existing logic too much.
        // The original code pushed to outbox unshift.
        this.outbox.unshift(frame);
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
        } else {
            // Queue it? Ideally yes, but tools are usually sent on connect.
            // If we put it in outbox, it will be sent on open.
            this.outbox.push(frame);
        }
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
        // Don't clear outbox here anymore! It's persistent.
        // this.outbox = [];
        this.sentCommandFrame = false;

        if (this.idleTimer) {
            try {
                clearTimeout(this.idleTimer);
            } catch { }
            this.idleTimer = null;
        }

        if (this.unsubscribeNetInfo) {
            this.unsubscribeNetInfo();
            this.unsubscribeNetInfo = null;
        }
    }
}
