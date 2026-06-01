/**
 * Cross-connection dedupe for client_action execution.
 *
 * A single client_action frame can be delivered to the device over BOTH the
 * active chat-channel socket AND the always-on user-channel device listener
 * (the Go hub broadcasts non-token frames to the user room while also routing
 * to the matching chat room). Without a guard, the same action would execute
 * twice. We claim each call_id exactly once; whichever handler sees it first
 * executes it, the other skips.
 */

const handled = new Set<string>();
const order: string[] = [];
const MAX_TRACKED = 256;

/**
 * Atomically claim a call_id for execution.
 * @returns true if this caller won the claim (should execute), false if it was
 *   already claimed by another handler (should skip).
 */
export function claimClientAction(callId: string | undefined | null): boolean {
    if (!callId) {
        // No call_id → cannot dedupe; allow execution (legacy/system path).
        return true;
    }
    if (handled.has(callId)) {
        return false;
    }
    handled.add(callId);
    order.push(callId);
    if (order.length > MAX_TRACKED) {
        const evicted = order.shift();
        if (evicted) {
            handled.delete(evicted);
        }
    }
    return true;
}
