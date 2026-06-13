/**
 * Integration sync: the server is the single source of truth for integration
 * identity (the UUID) and which accounts exist. The device is a cache.
 *
 * The device and server historically minted independent UUIDs for the same
 * account (e.g. a local IMAP row `2492b73a…` vs the server's `ca103f28…`), so
 * when the brain executed a client tool with the *server* UUID the device
 * couldn't find the credentials. This reconciler collapses that divergence:
 * it matches local rows to server rows by `(provider, account_email)` and
 * rewrites the local id to the server UUID, keeping credentials on-device.
 *
 * `reconcile()` is pure (server list + local list → operations) so it can be
 * unit-tested without a database. `syncIntegrationsFromServer()` fetches the
 * canonical list and applies the operations.
 */
import { authStore } from '../../apiClient';
import { getApiUrl } from '../../config';
import { integrationStorage } from './IntegrationStorage';
import { getIntegrationMetadata } from './registry';

export interface ServerIntegration {
    id: string;
    provider: string;
    accountEmail: string;
    enabled: boolean;
    name: string;
}

export interface LocalIntegrationRef {
    id: string;
    provider: string;
    accountEmail?: string;
}

export type SyncOp =
    | { type: 'rekey'; oldId: string; newId: string }
    | {
          type: 'insertStub';
          id: string;
          provider: string;
          name: string;
          accountEmail: string;
          enabled: boolean;
      }
    | { type: 'update'; id: string; name: string; enabled: boolean }
    | { type: 'deleteOrphan'; id: string };

/** Natural key shared by device and server: provider + account email. */
function naturalKey(provider: string, accountEmail?: string): string {
    return `${(provider || '').toLowerCase()}::${(
        accountEmail || ''
    ).toLowerCase()}`;
}

/**
 * Compute the operations that make the local store mirror the server list.
 * Pure — no side effects.
 *
 * `isServerTracked` decides whether a local row absent from the server may be
 * orphan-deleted. Client-only providers (ios_*) and providers stored outside
 * the `integrations` table (telegram → plugin_data) are NEVER on the server, so
 * deleting them would wipe an integration the moment it's added. The default
 * (`() => true`) preserves the original behaviour; the real caller passes a
 * registry-backed predicate.
 */
export function reconcile(
    server: ServerIntegration[],
    local: LocalIntegrationRef[],
    isServerTracked: (provider: string) => boolean = () => true,
): SyncOp[] {
    const ops: SyncOp[] = [];

    const localByKey = new Map<string, LocalIntegrationRef>();
    for (const l of local) {
        // First writer wins; duplicates become orphans handled below.
        const k = naturalKey(l.provider, l.accountEmail);
        if (!localByKey.has(k)) localByKey.set(k, l);
    }

    const matchedLocalIds = new Set<string>();

    for (const s of server) {
        const match = localByKey.get(naturalKey(s.provider, s.accountEmail));
        if (match) {
            matchedLocalIds.add(match.id);
            if (match.id !== s.id) {
                ops.push({ type: 'rekey', oldId: match.id, newId: s.id });
            }
            ops.push({
                type: 'update',
                id: s.id,
                name: s.name,
                enabled: s.enabled,
            });
        } else {
            ops.push({
                type: 'insertStub',
                id: s.id,
                provider: s.provider,
                name: s.name,
                accountEmail: s.accountEmail,
                enabled: s.enabled,
            });
        }
    }

    // Local rows the server no longer has → drop them (server is authoritative).
    // But only for providers the server actually tracks; client-only providers
    // (ios_*, telegram) live only on the device and must never be orphaned here.
    for (const l of local) {
        if (!matchedLocalIds.has(l.id) && isServerTracked(l.provider)) {
            ops.push({ type: 'deleteOrphan', id: l.id });
        }
    }

    return ops;
}

/** Normalize a `/integrations` item (Go serializes struct fields PascalCase). */
function normalizeServerItem(item: any): ServerIntegration | null {
    if (!item) return null;
    const id = item.id ?? item.ID;
    const provider = item.provider ?? item.Provider;
    if (!id || !provider) return null;
    const accountEmail = item.account_email ?? item.AccountEmail ?? '';
    const name = item.name ?? item.Name ?? provider;
    const enabledRaw = item.enabled ?? item.Enabled;
    return {
        id: String(id),
        provider: String(provider),
        accountEmail: String(accountEmail),
        name: String(name),
        enabled: enabledRaw === undefined ? true : Boolean(enabledRaw),
    };
}

/**
 * Fetch the canonical integration list and reconcile the local cache to it.
 * No-ops on any fetch failure or an empty server list, so a transient error or
 * glitch never wipes the device's integrations.
 */
export async function syncIntegrationsFromServer(): Promise<void> {
    const token = authStore.getToken();
    if (!token) return;

    let items: any[];
    try {
        const resp = await fetch(`${getApiUrl()}/integrations`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
            console.warn(
                `[IntegrationSync] /integrations returned ${resp.status}, skipping`,
            );
            return;
        }
        const data = await resp.json();
        items = data?.items ?? data ?? [];
    } catch (e) {
        console.warn('[IntegrationSync] fetch failed, skipping:', e);
        return;
    }

    if (!Array.isArray(items)) return;

    const server = items
        .map(normalizeServerItem)
        .filter((s): s is ServerIntegration => s !== null);

    // An empty list from a 200 is ambiguous (could be a backend glitch); never
    // delete the whole local cache on it.
    if (server.length === 0) {
        console.log('[IntegrationSync] empty server list, skipping reconcile');
        return;
    }

    const local: LocalIntegrationRef[] = (
        await integrationStorage.getIntegrations()
    ).map(l => ({
        id: l.id,
        provider: l.provider,
        accountEmail: l.accountEmail,
    }));

    // Only providers persisted server-side may be orphan-deleted. Unknown /
    // unregistered providers default to NOT server-tracked, so a transient
    // registry gap never wipes a local integration.
    const ops = reconcile(
        server,
        local,
        provider => getIntegrationMetadata(provider)?.serverTracked ?? false,
    );
    if (ops.length === 0) return;

    for (const op of ops) {
        try {
            switch (op.type) {
                case 'rekey':
                    await integrationStorage.rekeyIntegration(
                        op.oldId,
                        op.newId,
                    );
                    break;
                case 'insertStub':
                    await integrationStorage.insertIntegrationStub({
                        id: op.id,
                        provider: op.provider,
                        name: op.name,
                        accountEmail: op.accountEmail,
                        enabled: op.enabled,
                    });
                    break;
                case 'update':
                    await integrationStorage.updateIntegration(op.id, {
                        name: op.name,
                        enabled: op.enabled,
                    });
                    break;
                case 'deleteOrphan':
                    await integrationStorage.deleteIntegration(op.id);
                    break;
            }
        } catch (e) {
            console.warn('[IntegrationSync] op failed:', op, e);
        }
    }

    console.log(
        `[IntegrationSync] applied ${ops.length} op(s):`,
        ops.map(o => o.type),
    );
}
