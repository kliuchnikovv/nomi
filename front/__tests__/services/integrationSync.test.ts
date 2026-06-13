import {
    reconcile,
    ServerIntegration,
    LocalIntegrationRef,
    SyncOp,
} from '@genie/front/services/integrations/integrationSync';

const server = (
    id: string,
    provider: string,
    accountEmail: string,
    enabled = true,
    name = provider,
): ServerIntegration => ({ id, provider, accountEmail, enabled, name });

const local = (
    id: string,
    provider: string,
    accountEmail?: string,
): LocalIntegrationRef => ({ id, provider, accountEmail });

describe('reconcile', () => {
    it('rekeys a local row whose id diverges from the server UUID', () => {
        const ops = reconcile(
            [server('server-uuid', 'imap', 'me@icloud.com')],
            [local('device-uuid', 'imap', 'me@icloud.com')],
        );
        expect(ops).toContainEqual<SyncOp>({
            type: 'rekey',
            oldId: 'device-uuid',
            newId: 'server-uuid',
        });
        // and keeps metadata in sync under the new id
        expect(ops).toContainEqual<SyncOp>({
            type: 'update',
            id: 'server-uuid',
            name: 'imap',
            enabled: true,
        });
        // no destructive op for the matched row
        expect(ops.some(o => o.type === 'deleteOrphan')).toBe(false);
    });

    it('matches case-insensitively on provider + email', () => {
        const ops = reconcile(
            [server('s1', 'IMAP', 'Me@iCloud.com')],
            [local('d1', 'imap', 'me@icloud.com')],
        );
        expect(ops).toContainEqual<SyncOp>({
            type: 'rekey',
            oldId: 'd1',
            newId: 's1',
        });
    });

    it('does not rekey when ids already match (update only)', () => {
        const ops = reconcile(
            [server('same', 'gmail', 'a@gmail.com')],
            [local('same', 'gmail', 'a@gmail.com')],
        );
        expect(ops.some(o => o.type === 'rekey')).toBe(false);
        expect(ops).toContainEqual<SyncOp>({
            type: 'update',
            id: 'same',
            name: 'gmail',
            enabled: true,
        });
    });

    it('inserts a stub for a server integration the device has never seen', () => {
        const ops = reconcile(
            [server('new-srv', 'github', 'dev@x.com', false, 'GitHub')],
            [],
        );
        expect(ops).toContainEqual<SyncOp>({
            type: 'insertStub',
            id: 'new-srv',
            provider: 'github',
            name: 'GitHub',
            accountEmail: 'dev@x.com',
            enabled: false,
        });
    });

    it('deletes a local row the server no longer has', () => {
        const ops = reconcile(
            [server('keep', 'imap', 'me@icloud.com')],
            [
                local('keep', 'imap', 'me@icloud.com'),
                local('gone', 'github', 'old@x.com'),
            ],
        );
        expect(ops).toContainEqual<SyncOp>({
            type: 'deleteOrphan',
            id: 'gone',
        });
        // the matched row is untouched by deletion
        expect(
            ops.filter(o => o.type === 'deleteOrphan').map(o => (o as any).id),
        ).toEqual(['gone']);
    });

    it('is a no-op when device and server already agree', () => {
        const ops = reconcile(
            [server('a', 'gmail', 'a@gmail.com')],
            [local('a', 'gmail', 'a@gmail.com')],
        );
        expect(ops).toEqual([
            { type: 'update', id: 'a', name: 'gmail', enabled: true },
        ]);
    });

    it('reconciles a mixed fleet in one pass', () => {
        const ops = reconcile(
            [
                server('imap-srv', 'imap', 'me@icloud.com'),
                server('gh-srv', 'github', 'dev@x.com'),
            ],
            [
                local('imap-dev', 'imap', 'me@icloud.com'), // rekey
                local('stale', 'calendar', 'cal@x.com'), // orphan
            ],
        );
        const types = ops.map(o => o.type).sort();
        expect(types).toEqual(
            ['deleteOrphan', 'insertStub', 'rekey', 'update'].sort(),
        );
    });
});
