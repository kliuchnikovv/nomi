import { Frame } from './screens/main/models.tsx';


type Handlers = {
    // onToken?: (frame: Frame) => void;
    onMessage?: (frame: Frame) => void; // For full messages
    onDone?: (frame: Frame) => void;
    onError?: (err: any) => void;
    // onAnnounce?: (chatId: string) => void;
    onUnauthorized?: () => Promise<boolean> | boolean; // return true if token refreshed
    onMeta?: (meta: Frame) => void;
    onPing?: (ping: Frame) => Promise<boolean> | boolean;
};

export class ChatSocket {
    private ws: any | null = null;
    private readonly rootUrl: string;
    private readonly getToken: () => string | null;
    private readonly getChatId: () => string | null;
    private readonly getMessageId: () => string | null;
    private handlers: Handlers = {};
    private outbox: any[] = [];
    private idleTimer: any = null;
    private idleTimeoutMs = 5 * 60 * 1000; // 5 minutes

    constructor(
        rootUrl: string,
        getToken: () => string | null,
        getChatId: () => string | null,
        getMessageId: () => string | null,
    ) {
        this.rootUrl = rootUrl;
        this.getToken = getToken;
        this.getChatId = getChatId;
        this.getMessageId = getMessageId;
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

    open(initialQ?: string, initialSessionId?: string) {
        // const chatId = this.getChatId();
        const token = this.getToken();
        // messageId is per-message and should not be required to open a long-lived socket
        // const messageId = this.getMessageId();
        if (!token) {
            console.log("WS open blocked: missing token",token);
            return;
        }

        if (this.ws) {
            try {
                this.ws.close();
            } catch { }
            this.ws = null;
        }

        const qs = new URLSearchParams();
        // qs.set('chatId', chatId);
        if (token) qs.set('token', token);
        // if (messageId) qs.set('messageId', messageId);
        // if (initialQ) qs.set('q', initialQ);
        if (initialSessionId) qs.set('sessionId', initialSessionId);

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
                const queue = this.outbox;
                this.outbox = [];
                for (const msg of queue) {
                    try {
                        ws.send(JSON.stringify(msg));
                    } catch { }
                }
            };

            ws.onmessage = async (e: any) => {
                this.touchActivity();
                const raw = typeof e.data === 'string' ? e.data : '';
                try {
                    const rawJson = raw ? JSON.parse(raw) : null;
                    if (!rawJson) return;

                    const frame = rawJson as Frame;

                    const kind = frame.kind;
                    const data = frame.payload;
                    const operation = frame.op;

                    console.log(`${operation} with kind ${kind}`, frame);
                    switch (operation) {
                        case 'ping':
                            this.handlers.onPing?.(frame);
                            break;
                        case 'error':
                            if (data.code !== 401 || retried) {
                                this.handlers.onError?.(frame);
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
                        default:
                            console.warn(`Unknown message op: ${operation}`, rawJson);
                            break;
                    }

                    // if (frame.op === 'announce' || data?.chat_id || data?.chatId) {
                    //     const announcedId = data?.chat_id || data?.chatId || data?.id;
                    //     if (announcedId) this.handlers.onAnnounce?.(String(announcedId));
                    // }
                    //
                    // if (kind === 'data' && typeof data?.message === 'string') {
                    //     if (data.eof) {
                    //         // This is a full message
                    //         this.handlers.onMessage?.(data.message, data.message_id);
                    //     } else {
                    //         // This is a streaming token
                    //         this.handlers.onToken?.(data.message);
                    //     }
                    // } else if (kind === 'done') {
                    //     this.handlers.onDone?.(data?.message_id);
                    // } else if (
                    //     kind === 'error' &&
                    //     (data?.code === 401 || data?.status === 401)
                    // ) {
                    //     if (!retried) {
                    //         retried = true;
                    //         const ok = await (this.handlers.onUnauthorized?.() ?? false);
                    //         if (ok) {
                    //             try { ws.close(); } catch {}
                    //             this.open();
                    //             return;
                    //         }
                    //     }
                    // }
                } catch (err) {
                    console.warn('Failed to parse WS message:', err, raw);
                }
            };

            ws.onerror = (e: any) => {
                console.error('WebSocket onerror event:', e); // Log the full event object
                this.handlers.onError?.(e);
            };

            ws.onclose = async (e: any) => {
                console.log('WebSocket onclose event:', e.code, e.reason); // Log code and reason
                if (this.ws === ws) this.ws = null;
                const code = e?.code;
                const unauthorized = code === 4401 || code === 4001 || code === 1008;
                if (unauthorized && !retried) {
                    retried = true;
                    const ok = await (this.handlers.onUnauthorized?.() ?? false);
                    if (ok) {
                        this.open();
                        return;
                    }
                }
            };
        } catch (e) {
            this.handlers.onError?.(e);
        }
    }

    sendMessage(message: string, sessionId: string, messageID?: string) {
        console.log('Sending message:', message, sessionId);
        const chatID = this.getChatId();
        // const messageID = this.getMessageId();
        if (!chatID) return;

        const msg = {
            id: 0,
            kind: 'data',
            chat_id: chatID,
            op: 'message',
            payload: {
                message_id: messageID,
                message: message,
                sessionId: sessionId, // Keep sending for server-side logging if needed
            },
        };
        console.log('Sending message:', msg);

        if (!this.ws) {
            // Queue the message and open the connection; onopen flushes outbox
            this.outbox.push(msg);
            this.open(message, sessionId);
            return;
        }

        if (this.isReady()) {
            try {
                console.log('send', JSON.stringify(msg));
                this.ws.send(JSON.stringify(msg));
                this.touchActivity();
            } catch {
                this.outbox.push(msg);
            }
        } else {
            this.outbox.push(msg);
        }
    }

    close() {
        try {
            this.ws?.close();
        } catch { }

        this.ws = null;
        this.outbox = [];

        if (this.idleTimer) {
            try {
                clearTimeout(this.idleTimer);
            } catch { }
            this.idleTimer = null;
        }
    }
}
