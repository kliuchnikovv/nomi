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

    private readonly instanceId = `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
    private shouldReconnect = false;
    private reconnectDelay = 1000;
    private reconnectTimer: any = null;
    private isIntentionallyClosed = false;
    private isConnecting = false;
    private channel: 'chat' | 'user' = 'chat';
    private chatId: string | null = null;

    // private sentCommandFrame = false; // Command frames are per-message/chat context now?
    // Actually, team commands are sent once per session usually. But in a global socket, we might switch contexts.
    // For now, let's keep it simple: we send commands when sending a message if needed, or rely on the backend session.

    constructor() { }

    getDebugState() {
        return {
            instanceId: this.instanceId,
            channel: this.channel,
            chatId: this.chatId,
            hasWs: !!this.ws,
            readyState: this.ws?.readyState,
            isConnecting: this.isConnecting,
            shouldReconnect: this.shouldReconnect,
            isIntentionallyClosed: this.isIntentionallyClosed,
        };
    }

    setToken(token: string | null) {
        this.token = token;
        // Auto-connect if we have a token and not already connected/connecting
        if (token && !this.isReady() && !this.ws) {
            this.connect();
        }
    }

    setChannel(channel: 'chat' | 'user') {
        this.channel = channel;
    }

    setChatId(chatId: string | null) {
        this.chatId = chatId;
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
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:58',message:'idle timeout triggered',data:{idleTimeoutMs:this.idleTimeoutMs,isReady:this.isReady()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
            this.close();
        }, this.idleTimeoutMs);
    }

    private scheduleReconnect() {
        if (this.reconnectTimer || !this.token) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:63',message:'scheduleReconnect blocked',data:{hasTimer:!!this.reconnectTimer,hasToken:!!this.token},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
            // #endregion
            return;
        }

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:66',message:'scheduling reconnect',data:{reconnectDelay:this.reconnectDelay,hasToken:!!this.token},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
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
        const ready = !!this.ws && this.ws.readyState === 1;
        if (this.ws && !ready) {
            console.log(`[Socket] Not ready: ws exists=${!!this.ws}, readyState=${this.ws?.readyState}`);
        }
        return ready;
    }

    // Alias for open to match expected API
    connect() {
        this.isIntentionallyClosed = false;
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

        // If we're trying to connect to a chat channel, we must have an active chatId.
        // Otherwise backend will likely close the connection (and we can end up in reconnect loops).
        if (this.channel === 'chat' && !this.chatId) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:open',message:'open blocked - chat channel without chatId',data:{channel:this.channel,hasChatId:!!this.chatId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            return;
        }

        // If already connected, don't reconnect
        if (this.isReady()) {
            console.log('[Socket] Already connected, skipping');
            return;
        }

        // Prevent multiple simultaneous connection attempts
        // But allow retry if connection is stuck
        if (this.isConnecting && this.ws) {
            const wsState = this.ws.readyState;
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:120',message:'multiple connection attempt detected',data:{wsState,isConnecting:this.isConnecting,hasWs:!!this.ws},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            console.log(`[Socket] Connection in progress, state: ${wsState}`, {
                readyState: wsState,
                isConnecting: this.isConnecting
            });
            // If WebSocket is already connected (1), skip
            if (wsState === 1) {
                console.log('[Socket] Already connected, skipping');
                return;
            }
            // If WebSocket is in connecting state (0), wait a bit before retrying
            // This prevents closing connections that are still establishing
            if (wsState === 0) {
                console.log('[Socket] Connection still establishing, skipping duplicate attempt');
                return;
            }
            // If closing (2) or closed (3), allow retry
            if (wsState === 2 || wsState === 3) {
                console.log('[Socket] Connection closing/closed, allowing retry');
                try {
                    this.ws.close();
                } catch { }
                this.ws = null;
                this.isConnecting = false;
            } else {
                console.log('[Socket] Connection already in progress, skipping');
                return;
            }
        }

        // Safety: ensure we want to be connected
        this.isIntentionallyClosed = false;
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
        if (this.channel === 'user') {
            qs.append('channel', 'user');
        } else if (this.chatId) {
            qs.append('chat_id', this.chatId);
        }

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

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:open',message:'open attempting',data:{instanceId:this.instanceId,channel:this.channel,hasChatId:!!this.chatId,chatId:this.chatId?String(this.chatId).slice(0,8)+'…':null,wsUrlSafe:wsUrl.replace(/token=[^&]+/,'token=REDACTED')},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        console.log('Attempting to connect to Global WebSocket:', wsUrl);

        let retried = false;
        this.isConnecting = true;

        // Set a timeout to reset isConnecting flag if connection takes too long
        const connectionTimeout = setTimeout(() => {
            if (this.isConnecting && this.ws && this.ws.readyState !== 1) {
                console.warn('[Socket] Connection timeout, resetting isConnecting flag');
                this.isConnecting = false;
            }
        }, 10000); // 10 seconds timeout

        try {
            const ws: any = new (WebSocket as any)(
                wsUrl,
                [],
                token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
            );
            this.ws = ws;

            ws.onopen = () => {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:onopen',message:'onopen - connection established',data:{instanceId:this.instanceId,channel:this.channel,hasChatId:!!this.chatId,chatId:this.chatId?String(this.chatId).slice(0,8)+'…':null,readyState:ws.readyState,shouldReconnect:this.shouldReconnect,wsUrlSafe:wsUrl.replace(/token=[^&]+/,'token=REDACTED')},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                console.log('[Socket] Connected successfully', {
                    readyState: ws.readyState,
                    url: wsUrl.substring(0, 50) + '...'
                });
                // Mark that connection was successfully established
                (ws as any)._wasConnected = true;
                clearTimeout(connectionTimeout);
                this.isConnecting = false;
                this.reconnectDelay = 1000; // Reset backoff
                this.touchActivity();
                this.processOutbox(); // Replaced inline loop with method call
            };

            ws.onmessage = async (e: any) => {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:onmessage',message:'onmessage received',data:{instanceId:this.instanceId,channel:this.channel,configuredChatId:this.chatId?String(this.chatId).slice(0,8)+'…':null,dataLength:e?.data?.length,dataType:typeof e?.data,readyState:ws.readyState},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'J'})}).catch(()=>{});
                // #endregion
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
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:frame',message:'frame parsed',data:{instanceId:this.instanceId,channel:this.channel,configuredChatId:this.chatId?String(this.chatId).slice(0,8)+'…':null,op,chatId:frame.chat_id?String(frame.chat_id).slice(0,8)+'…':null,kind:frame.kind,payloadType:frame.payload?.type,payloadKeys:frame.payload?Object.keys(frame.payload):[],hasMessage:!!frame.payload?.message,messagePreview:frame.payload?.message?.substring(0,100)},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'J'})}).catch(()=>{});
                        // #endregion

                        // Handle global routing
                        if (op === 'message' || op === 'tools' || op === 'model' || op === 'done' || op === 'signal') {
                            const chatId = frame.chat_id;
                            // #region agent log
                            fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:route',message:'routing frame',data:{instanceId:this.instanceId,channel:this.channel,configuredChatId:this.chatId?String(this.chatId).slice(0,8)+'…':null,op,chatId:chatId?String(chatId).slice(0,8)+'…':null,kind:frame.kind,hasPayload:!!frame.payload},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'J'})}).catch(()=>{});
                            // #endregion
                            if (chatId) {
                                // 1. Update Global Store
                                // NOTE: backend can forward the same chat stream into both:
                                // - chat room websocket (channel=chat&chat_id=...)
                                // - user notification websocket (channel=user)
                                //
                                // Previously we skipped *all* op=message frames on the user channel,
                                // which caused the UI to never render assistant replies when the app
                                // happened to stay connected only on channel=user.
                                //
                                // To avoid duplication/noise, we only write DATA messages to the store.
                                if (op === 'message' && frame.kind === 'data') {
                                    // #region agent log
                                    fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:addMessage',message:'calling addMessage',data:{instanceId:this.instanceId,channel:this.channel,configuredChatId:this.chatId?String(this.chatId).slice(0,8)+'…':null,chatId:chatId?String(chatId).slice(0,8)+'…':null,op:frame.op,kind:frame.kind,payloadType:frame.payload?.type,messageId:frame.payload?.message_id?String(frame.payload?.message_id).slice(0,8)+'…':null,role:frame.payload?.role,sender:frame.payload?.sender,hasMessage:!!frame.payload?.message,messagePreview:frame.payload?.message?.substring(0,50)},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'M'})}).catch(()=>{});
                                    // #endregion
                                    useChatStore.getState().addMessage(chatId, frame.payload);
                                } else if (op === 'message') {
                                    // #region agent log
                                    fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:addMessage',message:'skipped non-data message for store',data:{instanceId:this.instanceId,channel:this.channel,chatId:chatId?String(chatId).slice(0,8)+'…':null,kind:frame.kind,payloadType:frame.payload?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run7',hypothesisId:'M'})}).catch(()=>{});
                                    // #endregion
                                }

                                // 2. Notify Listeners (legacy handlers for specific effects)
                                // Only call legacy handlers if they are still relevant.
                                // ChatContext might still want to know about completion or errors.
                                if (op === 'message' && frame.kind === 'data') {
                                    // #region agent log
                                    fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:283',message:'calling onMessage handler',data:{hasHandler:!!this.handlers.onMessage},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'H'})}).catch(()=>{});
                                    // #endregion
                                    this.handlers.onMessage?.(frame);
                                } else if (op === 'done') {
                                    // #region agent log
                                    fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:285',message:'calling onDone handler',data:{hasHandler:!!this.handlers.onDone},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'H'})}).catch(()=>{});
                                    // #endregion
                                    this.handlers.onDone?.(frame);
                                } else if (op === 'signal') {
                                    this.handlers.onSignal?.(frame);
                                } else {
                                    this.handlers.onMeta?.(frame);
                                }
                            } else {
                                // #region agent log
                                fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:293',message:'frame skipped - no chatId',data:{op,kind:frame.kind},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'H'})}).catch(()=>{});
                                // #endregion
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
                                            'agent_error': 'Ошибка выполнения задачи',
                                            'agent_not_found': 'Агент не найден',
                                            'task_failed': 'Ошибка обработки запроса',
                                            'worker_error': 'Ошибка сервера',
                                            'build_failed': 'Ошибка инициализации',
                                            'stream_failed': 'Ошибка генерации ответа',
                                            'timeout': 'Превышено время ожидания',
                                            'not_found': 'Ресурс не найден',
                                            'not-found': 'Ресурс не найден',
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
                clearTimeout(connectionTimeout);
                this.isConnecting = false;
            };

            ws.onclose = async (e: any) => {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:337',message:'onclose event',data:{code:e?.code,reason:e?.reason,shouldReconnect:this.shouldReconnect,isIntentionallyClosed:this.isIntentionallyClosed,readyState:ws.readyState,hasToken:!!this.token},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,D'})}).catch(()=>{});
                // #endregion
                console.log('[Socket] WebSocket onclose event:', e.code, e.reason, {
                    shouldReconnect: this.shouldReconnect,
                    isIntentionallyClosed: this.isIntentionallyClosed,
                    readyState: ws.readyState
                });
                clearTimeout(connectionTimeout);
                this.isConnecting = false;
                if (this.ws === ws) this.ws = null;
                const code = e?.code;

                // Don't reconnect if intentionally closed
                if (this.isIntentionallyClosed) {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:349',message:'intentionally closed, skipping reconnect',data:{code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                    // #endregion
                    console.log('[Socket] Connection intentionally closed, skipping reconnect');
                    return;
                }

                // Code 0 usually means connection closed before establishment or network error
                // Don't reconnect immediately for code 0 - it might be a server rejection
                if (code === 0) {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:357',message:'code 0 detected',data:{code,shouldReconnect:this.shouldReconnect,wasConnected:ws.readyState===1},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A,D'})}).catch(()=>{});
                    // #endregion
                    console.log('[Socket] Connection closed with code 0 (before establishment or network error)');
                    // Code 0 with readyState 3 (CLOSED) means connection never fully established
                    // This is likely a server rejection or network error - don't reconnect immediately
                    // Only reconnect if we were actually connected (readyState was 1) before closing
                    // But readyState in onclose is always 3 (CLOSED), so we need to track connection state
                    const wasConnected = ws.readyState === 1 || (ws as any)._wasConnected;
                    if (wasConnected && this.shouldReconnect) {
                        console.log('[Socket] Was connected before close, scheduling reconnect');
                        this.scheduleReconnect();
                    } else {
                        console.log('[Socket] Connection never fully established (code 0), not reconnecting to avoid loop');
                        // Don't reconnect - this prevents infinite reconnection loops
                        // The connection will be retried when token changes or user action triggers it
                    }
                    return;
                }

                // Unauthorized
                if ((code === 4401 || code === 4001 || code === 1008 || code === 1006) && !retried) {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:370',message:'unauthorized error',data:{code,retried},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                    // #endregion
                    retried = true;
                    this.shouldReconnect = false; // Stop auto-reconnect on auth error
                    const ok = await (this.handlers.onUnauthorized?.() ?? false);
                    if (ok) {
                        this.connect();
                        return;
                    }
                    return;
                }

                // Normal closure (1000) - only reconnect if shouldReconnect is true
                // This handles cases where server closes connection normally but we want to stay connected
                if (code === 1000 && !this.shouldReconnect) {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:383',message:'normal closure, skipping reconnect',data:{code,shouldReconnect:this.shouldReconnect},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                    // #endregion
                    console.log('[Socket] Normal closure with shouldReconnect=false, skipping reconnect');
                    return;
                }

                // Reconnect for unexpected closures or when shouldReconnect is true
                if (this.shouldReconnect) {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:391',message:'scheduling reconnect',data:{code,shouldReconnect:this.shouldReconnect},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
                    // #endregion
                    this.scheduleReconnect();
                }
            };

        } catch (e) {
            clearTimeout(connectionTimeout);
            this.isConnecting = false;
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
        tools?: any[],
        userId?: string
    ) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:sendMessage',message:'sendMessage called',data:{instanceId:this.instanceId,channel:this.channel,configuredChatId:this.chatId?String(this.chatId).slice(0,8)+'…':null,targetChatId:chatId?String(chatId).slice(0,8)+'…':null,textLength:text?.length,role,hasUserId:!!userId,isReady:this.isReady(),hasWs:!!this.ws,readyState:this.ws?.readyState},timestamp:Date.now(),sessionId:'debug-session',runId:'run6',hypothesisId:'L'})}).catch(()=>{});
        // #endregion
        if (!chatId) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:451',message:'sendMessage blocked - no chatId',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'F'})}).catch(()=>{});
            // #endregion
            return;
        }

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
                // Required for Python RedisSession routing: it publishes to chat:user:<user_id>
                // Without this, it falls back to session_id (=chat_id) and Go Hub can't map frames to user rooms.
                user_id: userId,
            },
        };

        if (this.isReady()) {
            try {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:ws.send',message:'sending message via ws.send',data:{instanceId:this.instanceId,channel:this.channel,configuredChatId:this.chatId?String(this.chatId).slice(0,8)+'…':null,targetChatId:chatId?String(chatId).slice(0,8)+'…':null,textLength:text?.length,messageId:messageID?String(messageID).slice(0,8)+'…':null,hasUserId:!!userId},timestamp:Date.now(),sessionId:'debug-session',runId:'run6',hypothesisId:'L'})}).catch(()=>{});
                // #endregion
                this.ws.send(JSON.stringify(msg));
                this.touchActivity();
            } catch (err) {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:481',message:'send failed, adding to outbox',data:{error:err?.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'F'})}).catch(()=>{});
                // #endregion
                this.outbox.push(msg);
            }
        } else {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'socket.ts:485',message:'not ready, adding to outbox',data:{isReady:this.isReady(),hasWs:!!this.ws,readyState:this.ws?.readyState},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'F'})}).catch(()=>{});
            // #endregion
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
        this.isIntentionallyClosed = true;
        this.shouldReconnect = false;
        this.isConnecting = false;
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
