import { Frame } from './screens/main/models';
import { useChatStore } from './store/chatStore';
import { emitGenerationDone } from './store/generationDoneStore';
import { emitPlannerAction } from './store/plannerActionStore';
import { emitChatError } from './store/chatErrorStore';
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
    // Called when socket reconnects after a previous connection (not the initial connect)
    onReconnect?: () => void;
};

// Cap outbox size to prevent unbounded memory growth when socket is disconnected
const MAX_OUTBOX_SIZE = 100;

export class ChatSocket {
    private ws: any | null = null;
    private token: string | null = null;
    private handlers: Handlers = {};
    private outbox: any[] = [];
    private idleTimer: any = null;
    private idleTimeoutMs = 5 * 60 * 1000; // 5 minutes

    // Stall watchdog: while a generation is in flight, expect frames to keep arriving.
    // If the WS goes silent (e.g. iOS QUIC migration on network handoff), force a
    // reconnect so the next attempt re-establishes a working stream.
    private stallTimer: any = null;
    private stallTimeoutMs = 15000;

    private readonly instanceId = `${Date.now().toString(36)}_${Math.random()
        .toString(16)
        .slice(2, 8)}`;
    private shouldReconnect = false;
    private reconnectDelay = 1000;
    private reconnectTimer: any = null;
    private isIntentionallyClosed = false;
    private isConnecting = false;
    private channel: 'chat' | 'user' = 'chat';
    private chatId: string | null = null;
    private connectedChatId: string | null = null;
    private hasConnectedBefore = false;
    private frameIdCounter = 1;

    constructor() {}

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
        const changed =
            chatId !== null &&
            this.connectedChatId !== null &&
            chatId !== this.connectedChatId;
        this.chatId = chatId;
        if (changed && this.isReady() && this.channel === 'chat') {
            console.log(
                '[Socket] chatId changed, reconnecting from',
                this.connectedChatId,
                'to',
                chatId,
            );
            this.isIntentionallyClosed = false;
            this.shouldReconnect = true;
            this.close();
            this.open();
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
        if (this.reconnectTimer || !this.token) {
            return;
        }

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

    private startStallWatchdog() {
        this.clearStallWatchdog();
        this.stallTimer = setTimeout(() => {
            console.warn(
                '[Socket] Stall detected during generation — forcing reconnect',
            );
            this.stallTimer = null;
            this.shouldReconnect = true;
            this.isIntentionallyClosed = false;
            try {
                this.ws?.close();
            } catch {}
        }, this.stallTimeoutMs);
    }

    private clearStallWatchdog() {
        if (this.stallTimer) {
            clearTimeout(this.stallTimer);
            this.stallTimer = null;
        }
    }

    isReady(): boolean {
        const ready = !!this.ws && this.ws.readyState === 1;
        if (this.ws && !ready) {
            console.log(
                `[Socket] Not ready: ws exists=${!!this.ws}, readyState=${
                    this.ws?.readyState
                }`,
            );
        }
        return ready;
    }

    // Alias for open to match expected API
    connect() {
        this.isIntentionallyClosed = false;
        this.shouldReconnect = true;
        this.open();
    }

    /** Connect once — no auto-reconnect on server close (e.g. for short-lived sessions). */
    connectOnce() {
        this.isIntentionallyClosed = false;
        this.shouldReconnect = false;
        this.open();
    }

    /**
     * Push a message to the outbox, dropping the oldest if the cap is exceeded.
     */
    private pushToOutbox(msg: any) {
        if (this.outbox.length >= MAX_OUTBOX_SIZE) {
            console.warn(
                `[Socket] Outbox full (${MAX_OUTBOX_SIZE}), dropping oldest message`,
            );
            this.outbox.shift();
        }
        this.outbox.push(msg);
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
            console.log('WS open blocked: missing token');
            return;
        }

        // If we're trying to connect to a chat channel, we must have an active chatId.
        // Otherwise backend will likely close the connection (and we can end up in reconnect loops).
        if (this.channel === 'chat' && !this.chatId) {
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
            console.log(`[Socket] Connection in progress, state: ${wsState}`, {
                readyState: wsState,
                isConnecting: this.isConnecting,
            });
            // If WebSocket is already connected (1), skip
            if (wsState === 1) {
                console.log('[Socket] Already connected, skipping');
                return;
            }
            // If WebSocket is in connecting state (0), wait a bit before retrying
            // This prevents closing connections that are still establishing
            if (wsState === 0) {
                console.log(
                    '[Socket] Connection still establishing, skipping duplicate attempt',
                );
                return;
            }
            // If closing (2) or closed (3), allow retry
            if (wsState === 2 || wsState === 3) {
                console.log(
                    '[Socket] Connection closing/closed, allowing retry',
                );
                try {
                    this.ws.close();
                } catch {}
                this.ws = null;
                this.isConnecting = false;
            } else {
                console.log(
                    '[Socket] Connection already in progress, skipping',
                );
                return;
            }
        }

        // Safety: ensure we want to be connected
        this.isIntentionallyClosed = false;
        // Do NOT override shouldReconnect here — it is set by connect() or connectOnce() before open()

        if (this.ws) {
            try {
                this.ws.close();
            } catch {}
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

        console.log('Attempting to connect to Global WebSocket:', wsUrl);

        let retried = false;
        this.isConnecting = true;

        // Set a timeout to reset isConnecting flag if connection takes too long
        const connectionTimeout = setTimeout(() => {
            if (this.isConnecting && this.ws && this.ws.readyState !== 1) {
                console.warn(
                    '[Socket] Connection timeout, resetting isConnecting flag',
                );
                this.isConnecting = false;
            }
        }, 10000); // 10 seconds timeout

        try {
            const ws: any = new (WebSocket as any)(
                wsUrl,
                [],
                token
                    ? { headers: { Authorization: `Bearer ${token}` } }
                    : undefined,
            );
            this.ws = ws;

            ws.onopen = () => {
                console.log('[Socket] Connected successfully', {
                    readyState: ws.readyState,
                    url: wsUrl.substring(0, 50) + '...',
                });
                (ws as any)._wasConnected = true;
                this.connectedChatId = this.chatId;
                clearTimeout(connectionTimeout);
                this.isConnecting = false;
                this.reconnectDelay = 1000; // Reset backoff
                this.touchActivity();
                this.processOutbox(); // Replaced inline loop with method call
                if (this.hasConnectedBefore) {
                    this.handlers.onReconnect?.();
                }
                this.hasConnectedBefore = true;
            };

            ws.onmessage = async (e: any) => {
                this.touchActivity();
                // Any inbound frame proves the stream is alive — postpone the stall trip.
                if (this.stallTimer) this.startStallWatchdog();
                const raw = typeof e.data === 'string' ? e.data : '';

                const lines = raw.split('\n');
                const MAX_STREAMING_BATCH = 50;
                let streamingCount = 0;

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    try {
                        const rawJson = JSON.parse(trimmed);
                        if (!rawJson) continue;

                        const frame = rawJson as Frame;
                        const op = frame.op;

                        const isStreamingText =
                            op === 'message' &&
                            frame.kind === 'data' &&
                            frame.payload?.type === 'text' &&
                            frame.payload?.delta;

                        if (isStreamingText) {
                            streamingCount++;
                            if (streamingCount > MAX_STREAMING_BATCH) continue;
                            const chatId = frame.chat_id;
                            if (chatId) {
                                useChatStore
                                    .getState()
                                    .addMessage(chatId, frame.payload);
                            }
                            continue;
                        }

                        if (
                            op === 'message' ||
                            op === 'tools' ||
                            op === 'model' ||
                            op === 'done' ||
                            op === 'signal'
                        ) {
                            const chatId = frame.chat_id;
                            if (chatId) {
                                if (op === 'message' && frame.kind === 'data') {
                                    useChatStore
                                        .getState()
                                        .addMessage(chatId, frame.payload);
                                    if (
                                        frame.payload?.type === 'client_action'
                                    ) {
                                        emitPlannerAction(
                                            chatId,
                                            frame.payload,
                                        );
                                    }
                                }

                                if (op === 'message' && frame.kind === 'data') {
                                    this.handlers.onMessage?.(frame);
                                } else if (op === 'done') {
                                    this.clearStallWatchdog();
                                    emitGenerationDone(String(chatId));
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
                                const errorInfo =
                                    frame.error ||
                                    frame.payload?.error ||
                                    frame.payload;
                                const errorCode =
                                    errorInfo?.code || frame.payload?.code;
                                const errorMessage =
                                    errorInfo?.message ||
                                    frame.payload?.message ||
                                    'An error occurred';
                                const errorDetails =
                                    errorInfo?.details ||
                                    frame.payload?.details;

                                if (errorDetails) {
                                    console.error(
                                        'Error details:',
                                        errorDetails,
                                    );
                                }

                                // Handle 401 unauthorized
                                if (
                                    errorCode === 401 ||
                                    frame.payload?.code === 401
                                ) {
                                    if (!retried) {
                                        retried = true;
                                        const ok =
                                            await (this.handlers.onUnauthorized?.() ??
                                                false);
                                        if (ok) {
                                            try {
                                                ws.close();
                                            } catch {}
                                            this.open();
                                        }
                                    }
                                } else {
                                    // Map error codes to user-friendly messages
                                    let userMessage = errorMessage;
                                    if (errorCode) {
                                        const errorMessages: Record<
                                            string,
                                            string
                                        > = {
                                            parse_failed:
                                                'Error processing message',
                                            save_failed: 'Error saving data',
                                            redis_failed:
                                                'Error connecting to server',
                                            marshal_failed:
                                                'Error processing response',
                                            dispatch_failed:
                                                'Error saving response',
                                            attachment_failed:
                                                'Error uploading attachments',
                                            agent_failed:
                                                'Error executing task',
                                            agent_error: 'Error executing task',
                                            agent_not_found: 'Agent not found',
                                            task_failed:
                                                'Error processing request',
                                            worker_error: 'Server error',
                                            build_failed:
                                                'Initialization error',
                                            stream_failed:
                                                'Error generating response',
                                            timeout: 'Timeout exceeded',
                                            not_found: 'Resource not found',
                                            'not-found': 'Resource not found',
                                            rate_limited: 'Rate limit exceeded',
                                        };
                                        userMessage =
                                            errorMessages[errorCode] ||
                                            errorMessage;
                                    }

                                    emitChatError(this.chatId ?? '', {
                                        code: errorCode,
                                        message: userMessage,
                                        details: errorDetails,
                                    });

                                    // Pass enhanced error object to handler
                                    this.handlers.onError?.({
                                        ...frame,
                                        error: {
                                            code: errorCode,
                                            message: userMessage,
                                            details: errorDetails,
                                            isRateLimited:
                                                errorCode === 'rate_limited',
                                        },
                                        message: userMessage,
                                    });
                                }
                                break;
                        }
                    } catch (err) {
                        console.warn(
                            'Failed to parse WS message:',
                            err,
                            trimmed,
                        );
                    }
                }
            };

            ws.onerror = (e: any) => {
                console.log('WebSocket onerror event:', e);
                clearTimeout(connectionTimeout);
                this.isConnecting = false;
            };

            ws.onclose = async (e: any) => {
                console.log(
                    '[Socket] WebSocket onclose event:',
                    e.code,
                    e.reason,
                    {
                        shouldReconnect: this.shouldReconnect,
                        isIntentionallyClosed: this.isIntentionallyClosed,
                        readyState: ws.readyState,
                    },
                );
                clearTimeout(connectionTimeout);
                this.isConnecting = false;
                if (this.ws === ws) this.ws = null;
                const code = e?.code;

                // Don't reconnect if intentionally closed
                if (this.isIntentionallyClosed) {
                    console.log(
                        '[Socket] Connection intentionally closed, skipping reconnect',
                    );
                    return;
                }

                // Handshake rejected by the server with a 4xx (e.g. 403 "chat not
                // found or access denied", 404). RN surfaces this as code 1006 with
                // the HTTP status in `reason`. This is fatal for the current target —
                // a stale/deleted chat_id will never succeed, and retrying just hammers
                // the server in a hot loop. Stop auto-reconnecting and surface the error
                // so the app can fall back to a valid chat.
                const reason = String(e?.reason ?? '');
                if (code === 1006 && /\b(403|404)\b/.test(reason)) {
                    console.log(
                        '[Socket] Handshake rejected by server, not reconnecting:',
                        reason,
                    );
                    this.shouldReconnect = false;
                    if (this.chatId) {
                        emitChatError(this.chatId, {
                            kind: 'forbidden',
                            code,
                            reason,
                        });
                    }
                    this.handlers.onError?.({
                        kind: 'forbidden',
                        code,
                        reason,
                    });
                    return;
                }

                // Code 0 usually means connection closed before establishment or network error
                // Don't reconnect immediately for code 0 - it might be a server rejection
                if (code === 0) {
                    console.log(
                        '[Socket] Connection closed with code 0 (before establishment or network error)',
                    );
                    // Code 0 with readyState 3 (CLOSED) means connection never fully established
                    // This is likely a server rejection or network error - don't reconnect immediately
                    // Only reconnect if we were actually connected (readyState was 1) before closing
                    // But readyState in onclose is always 3 (CLOSED), so we need to track connection state
                    const wasConnected =
                        ws.readyState === 1 || (ws as any)._wasConnected;
                    if (wasConnected && this.shouldReconnect) {
                        console.log(
                            '[Socket] Was connected before close, scheduling reconnect',
                        );
                        this.scheduleReconnect();
                    } else {
                        console.log(
                            '[Socket] Connection never fully established (code 0), not reconnecting to avoid loop',
                        );
                        // Don't reconnect - this prevents infinite reconnection loops
                        // The connection will be retried when token changes or user action triggers it
                    }
                    return;
                }

                // Unauthorized
                if (
                    (code === 4401 ||
                        code === 4001 ||
                        code === 1008 ||
                        code === 1006) &&
                    !retried
                ) {
                    retried = true;
                    this.shouldReconnect = false; // Stop auto-reconnect on auth error
                    const ok = await (this.handlers.onUnauthorized?.() ??
                        false);
                    if (ok) {
                        this.connect();
                        return;
                    }
                    return;
                }

                // Normal closure (1000) - only reconnect if shouldReconnect is true
                // This handles cases where server closes connection normally but we want to stay connected
                if (code === 1000 && !this.shouldReconnect) {
                    console.log(
                        '[Socket] Normal closure with shouldReconnect=false, skipping reconnect',
                    );
                    return;
                }

                // Reconnect for unexpected closures or when shouldReconnect is true
                if (this.shouldReconnect) {
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
        provider?: string,
        tools?: any[],
        userId?: string,
        endpoint?: string,
        authToken?: string,
        command?: any,
        contextItems?: any[],
        userLocation?: string,
    ) {
        if (!chatId) {
            return;
        }

        // Note: we don't assume we need to send "tools" command frame here anymore
        // unless explicitly needed. For "team" mode, we might need to handle it.
        // But let's assume the context is handled by the backend or initial setup.

        const payload: Record<string, unknown> = {
            message_id: messageID,
            message: text,
            role: role,
            model: model,
            provider: provider,
            sessionId: sessionId,
            attachment_ids: attachmentIDs,
            web_search: webSearch,
            thinking: thinking,
            tools: tools, // Pass integrations to backend
            // Required for Python RedisSession routing: it publishes to chat:user:<user_id>
            // Without this, it falls back to session_id (=chat_id) and Go Hub can't map frames to user rooms.
            user_id: userId,
            command: command,
            context_items: contextItems, // Context items (emails, documents, etc.)
            user_location: userLocation,
        };
        if (endpoint !== undefined && endpoint !== '') {
            payload.endpoint = endpoint;
        }
        if (authToken) {
            payload.auth_token = authToken; // For list/agent tools that call Go API (e.g. list items)
        }
        const msg = {
            id: 0,
            kind: 'data',
            chat_id: chatId,
            op: 'message',
            payload,
        };

        if (this.isReady()) {
            try {
                this.ws.send(JSON.stringify(msg));
                this.touchActivity();
                this.startStallWatchdog();
            } catch (err) {
                this.pushToOutbox(msg);
            }
        } else {
            this.pushToOutbox(msg);
            // If not connected, we should probably try to connect?
            // But open() doesn't take params anymore.
            // We assume open() is called by App.
            if (!this.ws) {
                this.open();
            }
        }
    }

    /**
     * Send client-extracted facts to backend (async, after local extraction completes).
     * Does not block chat; used for personalization in future sessions.
     */
    sendStoreFacts(chatId: string, userId: string, extractedFacts: string[]) {
        if (!userId || !extractedFacts?.length) {
            console.log(
                '[Socket] sendStoreFacts: no userId or empty facts, skipping',
            );
            return;
        }

        console.log(
            `[Socket] Sending ${extractedFacts.length} extracted fact(s) to server for user ${userId}`,
        );
        extractedFacts.forEach((fact, idx) => {
            console.log(`[Socket]   Fact ${idx + 1}: ${fact}`);
        });

        const msg = {
            id: 0,
            kind: 'data',
            chat_id: chatId,
            op: 'store_facts',
            payload: {
                user_id: userId,
                extracted_facts: extractedFacts,
            },
        };
        if (this.isReady()) {
            try {
                this.ws.send(JSON.stringify(msg));
                this.touchActivity();
                console.log('[Socket] ✓ Facts sent successfully via WebSocket');
            } catch (err) {
                // Non-critical: put in outbox so it gets sent when connection is restored
                console.warn(
                    '[Socket] sendStoreFacts failed, queuing for retry',
                    err,
                );
                this.pushToOutbox(msg);
            }
        } else {
            // Queue for later — same as sendMessage; processOutbox will send when socket connects
            this.pushToOutbox(msg);
            console.log(
                '[Socket] Facts queued (socket not ready), will send when connected',
            );
        }
    }

    // Send a command or tools frame
    sendMeta(chatId: string, op: string, payload: any) {
        const frame = {
            id: 0,
            kind: 'meta',
            op: op,
            chat_id: chatId,
            payload: payload,
        };

        if (this.isReady()) {
            this.ws.send(JSON.stringify(frame));
        } else {
            this.pushToOutbox(frame);
        }
    }

    changeModel(chatId: string, newModel: string) {
        this.sendMeta(chatId, 'model', { model: newModel });
    }

    sendStop(chatId: string) {
        this.sendMeta(chatId, 'stop', {});
    }

    /**
     * Send a command_call signal frame. Returns the frame id so the caller can
     * await the matching DONE frame that carries payload.meta.command_result.
     */
    sendCommandCall(
        chatId: string,
        sessionId: string,
        userId: string,
        name: string,
        args: object,
    ): number {
        const id = this.frameIdCounter++;
        const frame = {
            id,
            kind: 'signal',
            chat_id: chatId,
            op: 'command_call',
            payload: {
                name,
                args,
                sessionId,
                user_id: userId,
            },
        };
        if (this.isReady()) {
            try {
                this.ws.send(JSON.stringify(frame));
                this.touchActivity();
            } catch {
                this.pushToOutbox(frame);
            }
        } else {
            this.pushToOutbox(frame);
        }
        return id;
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
        } catch {}
        this.ws = null;
        this.connectedChatId = null;
        this.outbox = [];
    }
}

export const socket = new ChatSocket();
