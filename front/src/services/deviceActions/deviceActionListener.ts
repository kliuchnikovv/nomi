/**
 * Device Action Listener — always-on user-channel connection that lets the
 * remote brain execute client-only tools on this device even when the request
 * did NOT originate from the in-app chat (e.g. the user is messaging via
 * Telegram).
 *
 * Why this exists:
 *  - The Go hub routes a `client_action` frame to the matching chat room AND to
 *    the user's `RoomTypeUser` room. The in-app chat socket only ever connects
 *    on the `chat` channel for the currently-open chat, so a Telegram-originated
 *    client_action (whose chat_id is a server-side virtual session) never
 *    reaches the device through it. This listener holds a `user`-channel socket
 *    so those actions are received and executed.
 *  - Results are returned on the ORIGINATING session's channel by echoing the
 *    frame's chat_id back through sendClientToolResult — otherwise the brain,
 *    which waits on `chat:client_tool_result:{session_id}`, never gets the
 *    result and times out.
 *
 * Dedupe: when the user has both an open chat and this listener, an in-app
 * action can arrive on both sockets. claimClientAction() ensures each call_id
 * executes exactly once across connections.
 */

import { ChatSocket } from '../../socket';
import { Frame } from '../../screens/main/models';
import { claimClientAction } from './dedupe';

// Max delay accepted by setTimeout (32-bit). Used as the idle timeout so the
// listener is never auto-closed for inactivity (it is mostly idle by design).
const NEVER_IDLE_MS = 2147483647;

let listenerSocket: ChatSocket | null = null;
let currentToken: string | null = null;

async function executeAndReturn(frame: Frame): Promise<void> {
    const payload = frame.payload;
    const callId: string | undefined = payload?.call_id;
    const tool: string = payload?.tool;
    const method: string = payload?.method;
    const params: Record<string, any> = payload?.params || {};
    const integrationId: string | undefined = payload?.integration_id;

    // Reply on the originating session, not whatever chat the app has open.
    const replyChatId = frame.chat_id;

    if (!claimClientAction(callId)) {
        console.log(
            '[DeviceActionListener] Skipping already-claimed client_action call_id=',
            callId,
        );
        return;
    }

    const { sendClientToolResult } = await import('../../apiClient');

    try {
        const { clientToolExecutor } = await import(
            '../tools/ClientToolExecutor'
        );
        const result = await clientToolExecutor.execute({
            tool,
            method,
            params,
            integration_id: integrationId,
        });
        if (callId) {
            await sendClientToolResult(replyChatId, callId, result);
            console.log(
                '[DeviceActionListener] ✅ Executed + returned client_action call_id=',
                callId,
            );
        }
    } catch (error: any) {
        const errMsg = error?.message ?? String(error);
        console.warn(
            '[DeviceActionListener] client_action failed:',
            tool,
            method,
            errMsg,
        );
        if (callId) {
            await sendClientToolResult(replyChatId, callId, `Error: ${errMsg}`);
        }
    }
}

/**
 * Start (or update the token of) the always-on user-channel listener.
 * Safe to call repeatedly; it is idempotent for an unchanged token.
 */
export function startDeviceActionListener(token: string): void {
    if (!token) {
        return;
    }
    if (listenerSocket && currentToken === token && listenerSocket.isReady()) {
        return;
    }
    currentToken = token;

    if (!listenerSocket) {
        listenerSocket = new ChatSocket();
        listenerSocket.setChannel('user');
        listenerSocket.setIdleTimeout(NEVER_IDLE_MS);
        listenerSocket.setHandlers({
            onMessage: (frame: Frame) => {
                if (frame?.payload?.type === 'client_action') {
                    void executeAndReturn(frame);
                }
            },
        });
    }

    listenerSocket.setToken(token);
    if (!listenerSocket.isReady()) {
        listenerSocket.connect();
    }
}

/** Reconnect the listener if it dropped (call on app-active / network-online). */
export function ensureDeviceActionListener(): void {
    if (listenerSocket && currentToken && !listenerSocket.isReady()) {
        listenerSocket.connect();
    }
}

/** Stop and tear down the listener (call on logout / token cleared). */
export function stopDeviceActionListener(): void {
    if (listenerSocket) {
        listenerSocket.close();
        listenerSocket.setToken(null);
    }
    currentToken = null;
}
