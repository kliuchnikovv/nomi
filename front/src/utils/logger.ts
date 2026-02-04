/**
 * Logger utility for WebSocket and message handling
 * Provides structured logging with emojis for better readability
 */
type LogLevel = 'info' | 'warn' | 'error' | 'debug';
interface LogOptions {
    level?: LogLevel;
    emoji?: string;
    data?: any;
}
const ENABLE_DETAILED_LOGS = __DEV__; // Only in development
/**
 * Structured logger for WebSocket messages
 */
export const wsLogger = {
    /**
     * Log received WebSocket frame
     */
    received: (message: string, data?: any) => {
        if (!ENABLE_DETAILED_LOGS) return;
        console.log(`[WS ⬇️  Received] ${message}`, data || '');
    },
    /**
     * Log sent WebSocket frame
     */
    sent: (message: string, data?: any) => {
        if (!ENABLE_DETAILED_LOGS) return;
        console.log(`[WS ⬆️  Sent] ${message}`, data || '');
    },
    /**
     * Log WebSocket connection events
     */
    connection: (message: string, data?: any) => {
        if (!ENABLE_DETAILED_LOGS) return;
        console.log(`[WS 🔌 Connection] ${message}`, data || '');
    },
    /**
     * Log WebSocket errors
     */
    error: (message: string, error?: any) => {
        console.error(`[WS ❌ Error] ${message}`, error || '');
    },
    /**
     * Log frame routing
     */
    routing: (message: string, data?: any) => {
        if (!ENABLE_DETAILED_LOGS) return;
        console.log(`[WS 🎯 Routing] ${message}`, data || '');
    },
    /**
     * Log store updates
     */
    store: (message: string, data?: any) => {
        if (!ENABLE_DETAILED_LOGS) return;
        console.log(`[WS 💾 Store] ${message}`, data || '');
    },
};
/**
 * Structured logger for message handlers
 */
export const messageLogger = {
    /**
     * Log message handler start
     */
    start: (handler: string, data?: any) => {
        if (!ENABLE_DETAILED_LOGS) return;
        console.log(`[Handler 🎬 ${handler}]`, data || '');
    },
    /**
     * Log message handler completion
     */
    complete: (handler: string, data?: any) => {
        if (!ENABLE_DETAILED_LOGS) return;
        console.log(`[Handler ✅ ${handler}] Complete`, data || '');
    },
    /**
     * Log message handler skip
     */
    skip: (handler: string, reason: string, data?: any) => {
        if (!ENABLE_DETAILED_LOGS) return;
        console.log(`[Handler ⏭️  ${handler}] Skip: ${reason}`, data || '');
    },
    /**
     * Log message processing
     */
    process: (message: string, data?: any) => {
        if (!ENABLE_DETAILED_LOGS) return;
        console.log(`[Message 🔄] ${message}`, data || '');
    },
    /**
     * Log message creation
     */
    create: (message: string, data?: any) => {
        if (!ENABLE_DETAILED_LOGS) return;
        console.log(`[Message ➕] ${message}`, data || '');
    },
    /**
     * Log message update
     */
    update: (message: string, data?: any) => {
        if (!ENABLE_DETAILED_LOGS) return;
        console.log(`[Message 📝] ${message}`, data || '');
    },
};
/**
 * Structured logger for ChatStore
 */
export const storeLogger = {
    /**
     * Log store action
     */
    action: (action: string, data?: any) => {
        if (!ENABLE_DETAILED_LOGS) return;
        console.log(`[ChatStore 📥 ${action}]`, data || '');
    },
    /**
     * Log store state before update
     */
    before: (message: string, data?: any) => {
        if (!ENABLE_DETAILED_LOGS) return;
        console.log(`[ChatStore 📋 Before] ${message}`, data || '');
    },
    /**
     * Log store state after update
     */
    after: (message: string, data?: any) => {
        if (!ENABLE_DETAILED_LOGS) return;
        console.log(`[ChatStore 📋 After] ${message}`, data || '');
    },
    /**
     * Log store skip
     */
    skip: (reason: string, data?: any) => {
        if (!ENABLE_DETAILED_LOGS) return;
        console.log(`[ChatStore ⏭️  Skip] ${reason}`, data || '');
    },
};
/**
 * Helper to truncate long strings for logging
 */
export const truncate = (str: string, maxLength: number = 100): string => {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + `... (${str.length} chars)`;
};
/**
 * Helper to format message ID with agent ID
 */
export const formatMessageId = (id: string, agentId?: string): string => {
    return agentId ? `${id}-${agentId}` : id;
};
