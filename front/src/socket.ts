import { Frame } from './screens/main/models';
import { useChatStore } from './store/chatStore';
import { getApiUrl } from './config';

type Handlers = {
    onDone?: (frame: Frame) => void;
    onError?: (err: any) => void;
    onUnauthorized?: () => Promise<boolean> | boolean; // return true if token refreshed
    onPing?: (ping: Frame) => Promise<boolean> | boolean;
    onTools?: (frame: Frame) => void; // For tools list
    // Legacy handlers that might still be useful
    onMessage?: (frame: Frame) => void;
    onMeta?: (meta: Frame) => void;
    onSignal?: (frame: Frame) => void;
};

export class ChatSocket {
    private ws: any | null = null;
    private token: string | null = null;
    private handlers: Handlers = {};
    private outbox: any[] = [];
    private idleTimer: any = null;
    private idleTimeoutMs = 5 * 60 * 1000; // 5 minutes

    private shouldReconnect = false;
    private reconnectDelay = 1000;
    private reconnectTimer: any = null;

    // private sentCommandFrame = false; // Command frames are per-message/chat context now?
    // Actually, team commands are sent once per session usually. But in a global socket, we might switch contexts.
    // For now, let's keep it simple: we send commands when sending a message if needed, or rely on the backend session.

    constructor() { }

    setToken(token: string | null) {
        this.token = token;
        // Auto-connect if we have a token and not already connected/connecting
        if (token && !this.isReady() && !this.ws) {
            this.connect();
        }
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

    private scheduleReconnect() {
        if (this.reconnectTimer || !this.token) return;

        console.log(`[Socket] Reconnecting in ${this.reconnectDelay}ms...`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.open();
        }, this.reconnectDelay);

        // Exponential backoff with cap
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    }

    private touchActivity() {
        this.scheduleIdleClose();
    }

    isReady(): boolean {
        return !!this.ws && this.ws.readyState === 1;
    }

    // Alias for open to match expected API
    connect() {
        this.shouldReconnect = true;
        this.open();
    }

    processOutbox() {
        if (this.isReady() && this.outbox.length > 0) {
            const queue = this.outbox;
            this.outbox = [];
            for (const msg of queue) {
                try {
                    this.ws.send(JSON.stringify(msg));
                } catch {
                    // If send fails, put it back or retry?
                    // For now, fire and forget or it will be lost.
                }
            }
        }
    }

    // Global connection doesn't take chat-specific params initially
    open() {
        const token = this.token;
        if (!token) {
            console.log("WS open blocked: missing token");
            return;
        }

        // Safety: ensure we want to be connected
        this.shouldReconnect = true;

        if (this.ws) {
            try {
                this.ws.close();
            } catch { }
            this.ws = null;
        }

        // Clear any pending reconnect timer since we are connecting now
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
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
                console.log('[Socket] Connected');
                this.reconnectDelay = 1000; // Reset backoff
                this.touchActivity();
                this.processOutbox(); // Replaced inline loop with method call
            };

            ws.onmessage = async (e: any) => {
                this.touchActivity();
                const raw = typeof e.data === 'string' ? e.data : '';
                // NDJSON handling: split by newline
                const lines = raw.split('\n');

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    try {
                        const rawJson = JSON.parse(trimmed);
                        if (!rawJson) continue;

                        const frame = rawJson as Frame;
                        const op = frame.op;

                        // Handle global routing
                        if (op === 'message' || op === 'tools' || op === 'model' || op === 'done' || op === 'signal') {
                            const chatId = frame.chat_id;
                            if (chatId) {
                                // 1. Update Global Store
                                if (op === 'message') {
                                    useChatStore.getState().addMessage(chatId, frame.payload);
                                }

                                // 2. Notify Listeners (legacy handlers for specific effects)
                                // Only call legacy handlers if they are still relevant.
                                // ChatContext might still want to know about completion or errors.
                                if (op === 'message' && frame.kind === 'data') {
                                    this.handlers.onMessage?.(frame);
                                } else if (op === 'done') {
                                    this.handlers.onDone?.(frame);
                                } else if (op === 'signal') {
                                    this.handlers.onSignal?.(frame);
                                } else {
                                    this.handlers.onMeta?.(frame);
                                }
                            }
                        }

                        // Handle errors and system ops
                        switch (op) {
                            case 'ping':
                                this.handlers.onPing?.(frame);
                                break;
                            case 'error':
                                // Handle error frames with improved error extraction
                                const errorInfo = frame.error || frame.payload?.error || frame.payload;
                                const errorCode = errorInfo?.code || frame.payload?.code;
                                const errorMessage = errorInfo?.message || frame.payload?.message || 'Произошла ошибка';
                                const errorDetails = errorInfo?.details || frame.payload?.details;

                                // Log error details for debugging
                                if (errorDetails) {
                                    console.error('Error details:', errorDetails);
                                }

                                // Handle 401 unauthorized
                                if (errorCode === 401 || frame.payload?.code === 401) {
                                    if (!retried) {
                                        retried = true;
                                        const ok = await (this.handlers.onUnauthorized?.() ?? false);
                                        if (ok) {
                                            try { ws.close(); } catch { }
                                            this.open();
                                        }
                                    }
                                } else {
                                    // Map error codes to user-friendly messages
                                    let userMessage = errorMessage;
                                    if (errorCode) {
                                        const errorMessages: Record<string, string> = {
                                            'parse_failed': 'Ошибка обработки сообщения',
                                            'save_failed': 'Ошибка сохранения данных',
                                            'redis_failed': 'Ошибка соединения с сервером',
                                            'marshal_failed': 'Ошибка обработки ответа',
                                            'dispatch_failed': 'Ошибка сохранения ответа',
                                            'attachment_failed': 'Ошибка загрузки вложений',
                                            'agent_failed': 'Ошибка выполнения задачи',
                                            'task_failed': 'Ошибка обработки запроса',
                                            'worker_error': 'Ошибка сервера',
                                            'build_failed': 'Ошибка инициализации',
                                            'stream_failed': 'Ошибка генерации ответа',
                                            'timeout': 'Превышено время ожидания',
                                        };
                                        userMessage = errorMessages[errorCode] || errorMessage;
                                    }

                                    // Pass enhanced error object to handler
                                    this.handlers.onError?.({
                                        ...frame,
                                        error: {
                                            code: errorCode,
                                            message: userMessage,
                                            details: errorDetails,
                                        },
                                        message: userMessage,
                                    });
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
                    this.shouldReconnect = false; // Stop auto-reconnect on auth error
                    const ok = await (this.handlers.onUnauthorized?.() ?? false);
                    if (ok) {
                        this.connect();
                        return;
                    }
                }

                if (this.shouldReconnect) {
                    this.scheduleReconnect();
                }
            };

        } catch (e) {
            this.handlers.onError?.(e);
        }
    }

    // Helper to handle concatenated JSON - REMOVED (using NDJSON)

    sendMessage(
        text: string,
        chatId: string,
        sessionId: string,
        messageID?: string,
        attachmentIDs?: string[],
        webSearch?: boolean,
        thinking?: string,
        role: string = 'user',
        model?: string,
        tools?: any[]
    ) {
        if (!chatId) return;

        // Note: we don't assume we need to send "tools" command frame here anymore
        // unless explicitly needed. For "team" mode, we might need to handle it.
        // But let's assume the context is handled by the backend or initial setup.

        const msg = {
            id: 0,
            kind: 'data',
            chat_id: chatId,
            op: 'message',
            payload: {
                message_id: messageID,
                message: text,
                role: role,
                model: model,
                sessionId: sessionId,
                attachment_ids: attachmentIDs,
                web_search: webSearch,
                thinking: thinking,
                tools: tools, // Pass integrations to backend
            },
        };

        if (this.isReady()) {
            try {
                this.ws.send(JSON.stringify(msg));
                this.touchActivity();
            } catch {
                this.outbox.push(msg);
            }
        } else {
            this.outbox.push(msg);
            // If not connected, we should probably try to connect?
            // But open() doesn't take params anymore.
            // We assume open() is called by App.
            if (!this.ws) {
                this.open();
            }
        }
    }

    // Send a command or tools frame
    sendMeta(chatId: string, op: string, payload: any) {
        const frame = {
            id: 0,
            kind: 'meta',
            op: op,
            chat_id: chatId,
            payload: payload
        };

        if (this.isReady()) {
            this.ws.send(JSON.stringify(frame));
        } else {
            this.outbox.push(frame);
        }
    }

    changeModel(chatId: string, newModel: string) {
        this.sendMeta(chatId, 'model', { model: newModel });
    }

    sendStop(chatId: string) {
        this.sendMeta(chatId, 'stop', {});
    }

    close() {
        this.shouldReconnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        try {
            this.ws?.close();
        } catch { }
        this.ws = null;
        this.outbox = [];
    }
}

export const socket = new ChatSocket();
