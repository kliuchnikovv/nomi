/**
 * SQLite Database Service
 * Manages local database for integrations, emails, and cached content
 */

import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'genie.db';
const DATABASE_VERSION = 1;

let db: SQLite.SQLiteDatabase | null = null;

/**
 * Initialize the database and run migrations
 */
export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
    if (db) {
        return db;
    }

    db = await SQLite.openDatabaseAsync(DATABASE_NAME);

    // Run migrations
    await runMigrations(db);

    return db;
}

/**
 * Get the database instance (must call initDatabase first)
 */
export function getDatabase(): SQLite.SQLiteDatabase {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

/**
 * Run all pending migrations
 */
async function runMigrations(database: SQLite.SQLiteDatabase): Promise<void> {
    // Create migrations table if not exists
    await database.execAsync(`
        CREATE TABLE IF NOT EXISTS migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );
    `);

    // Get current version
    const result = await database.getFirstAsync<{ version: number }>(
        'SELECT MAX(version) as version FROM migrations'
    );
    const currentVersion = result?.version ?? 0;

    // Run pending migrations
    if (currentVersion < 1) {
        await migrateV1(database);
    }
    if (currentVersion < 2) {
        await migrateV2(database);
    }
}

/**
 * Migration V1: Initial schema
 */
async function migrateV1(database: SQLite.SQLiteDatabase): Promise<void> {
    await database.execAsync(`
        -- Integrations table
        CREATE TABLE IF NOT EXISTS integrations (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            name TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            account_email TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        -- Integration credentials (tokens encrypted)
        CREATE TABLE IF NOT EXISTS integration_credentials (
            integration_id TEXT PRIMARY KEY,
            access_token TEXT,
            refresh_token TEXT,
            token_expiry INTEGER,
            FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
        );

        -- Emails cache
        CREATE TABLE IF NOT EXISTS emails (
            id TEXT PRIMARY KEY,
            integration_id TEXT NOT NULL,
            gmail_id TEXT NOT NULL,
            thread_id TEXT,
            subject TEXT,
            snippet TEXT,
            from_email TEXT,
            from_name TEXT,
            to_emails TEXT,
            date INTEGER,
            labels TEXT,
            body_text TEXT,
            body_html TEXT,
            is_read INTEGER DEFAULT 0,
            fetched_at INTEGER NOT NULL,
            FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
        );

        -- Generated content cache (summaries, replies, etc.)
        CREATE TABLE IF NOT EXISTS generated_content (
            id TEXT PRIMARY KEY,
            integration_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
        );

        -- Indexes for performance
        CREATE INDEX IF NOT EXISTS idx_emails_integration ON emails(integration_id);
        CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date DESC);
        CREATE INDEX IF NOT EXISTS idx_emails_gmail_id ON emails(gmail_id);
        CREATE INDEX IF NOT EXISTS idx_generated_content_source ON generated_content(source_type, source_id);
        CREATE INDEX IF NOT EXISTS idx_integrations_provider ON integrations(provider);

        -- Record migration
        INSERT INTO migrations (version, applied_at) VALUES (1, ${Date.now()});
    `);

    console.log('[Database] Migration V1 applied');
}

/**
 * Migration V2: Events and Tasks extraction
 */
async function migrateV2(database: SQLite.SQLiteDatabase): Promise<void> {
    await database.execAsync(`
        -- Events extracted from source documents
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            title TEXT NOT NULL,
            start_date INTEGER NOT NULL,
            end_date INTEGER,
            location TEXT,
            status TEXT DEFAULT 'confirmed',
            created_at INTEGER NOT NULL,
            FOREIGN KEY (source_id) REFERENCES emails(id) ON DELETE CASCADE
        );

        -- Tasks/Action Items
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            title TEXT NOT NULL,
            due_date INTEGER,
            priority TEXT DEFAULT 'normal',
            is_completed INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (source_id) REFERENCES emails(id) ON DELETE CASCADE
        );

        -- Track analysis status
        ALTER TABLE emails ADD COLUMN analyzed_at INTEGER;
        
        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_events_date ON events(start_date);
        CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
        CREATE INDEX IF NOT EXISTS idx_emails_analyzed ON emails(analyzed_at);

        INSERT INTO migrations (version, applied_at) VALUES (2, ${Date.now()});
    `);
    console.log('[Database] Migration V2 applied');
}

/**
 * Close the database connection
 */
export async function closeDatabase(): Promise<void> {
    if (db) {
        await db.closeAsync();
        db = null;
    }
}

/**
 * Clear all data (for testing/logout)
 */
export async function clearDatabase(): Promise<void> {
    const database = getDatabase();
    await database.execAsync(`
        DELETE FROM events;
        DELETE FROM tasks;
        DELETE FROM generated_content;
        DELETE FROM emails;
        DELETE FROM integration_credentials;
        DELETE FROM integrations;
    `);
    console.log('[Database] All data cleared');
}
