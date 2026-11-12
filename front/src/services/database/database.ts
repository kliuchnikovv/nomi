/**
 * SQLite Database Service
 * Manages local database for integrations, emails, and cached content
 */

import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'nomi.db';
const DATABASE_VERSION = 9;

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
 * Get the database instance safely (returns null if not initialized)
 * Use this in contexts where early access may occur before init
 */
export function getDatabaseSafe(): SQLite.SQLiteDatabase | null {
    return db;
}

/**
 * Check if the database has been initialized
 */
export function isDatabaseReady(): boolean {
    return db !== null;
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
        'SELECT MAX(version) as version FROM migrations',
    );
    const currentVersion = result?.version ?? 0;

    // Run pending migrations
    if (currentVersion < 1) {
        await migrateV1(database);
    }
    if (currentVersion < 2) {
        await migrateV2(database);
    }
    if (currentVersion < 3) {
        await migrateV3(database);
    }
    if (currentVersion < 4) {
        await migrateV4(database);
    }
    if (currentVersion < 5) {
        await migrateV5(database);
    }
    if (currentVersion < 6) {
        await migrateV6(database);
    }
    if (currentVersion < 7) {
        await migrateV7(database);
    }
    if (currentVersion < 8) {
        await migrateV8(database);
    }
    if (currentVersion < 9) {
        await migrateV9(database);
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
 * Migration V3: Briefing system with analysis, urgency, and progress tracking
 */
async function migrateV3(database: SQLite.SQLiteDatabase): Promise<void> {
    await database.execAsync(`
        -- Analyzed emails with extracted metadata
        CREATE TABLE IF NOT EXISTS analyzed_emails (
            id TEXT PRIMARY KEY,
            email_id TEXT NOT NULL UNIQUE,
            urgency TEXT DEFAULT 'normal',
            connections TEXT,
            time_frame TEXT,
            analyzed_at INTEGER NOT NULL,
            FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
        );

        -- Daily briefings
        CREATE TABLE IF NOT EXISTS briefings (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL UNIQUE,
            headline TEXT,
            summary TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        -- Briefing items with completion tracking
        CREATE TABLE IF NOT EXISTS briefing_items (
            id TEXT PRIMARY KEY,
            briefing_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            priority TEXT DEFAULT 'normal',
            is_completed INTEGER DEFAULT 0,
            completed_at INTEGER,
            display_order INTEGER DEFAULT 0,
            FOREIGN KEY (briefing_id) REFERENCES briefings(id) ON DELETE CASCADE
        );

        -- Suggested actions (2-5 per item)
        CREATE TABLE IF NOT EXISTS suggested_actions (
            id TEXT PRIMARY KEY,
            briefing_item_id TEXT NOT NULL,
            action_type TEXT NOT NULL,
            label TEXT NOT NULL,
            params TEXT,
            display_order INTEGER DEFAULT 0,
            FOREIGN KEY (briefing_item_id) REFERENCES briefing_items(id) ON DELETE CASCADE
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_analyzed_emails_email ON analyzed_emails(email_id);
        CREATE INDEX IF NOT EXISTS idx_analyzed_emails_urgency ON analyzed_emails(urgency);
        CREATE INDEX IF NOT EXISTS idx_briefings_date ON briefings(date);
        CREATE INDEX IF NOT EXISTS idx_briefing_items_briefing ON briefing_items(briefing_id);
        CREATE INDEX IF NOT EXISTS idx_briefing_items_completed ON briefing_items(is_completed);
        CREATE INDEX IF NOT EXISTS idx_suggested_actions_item ON suggested_actions(briefing_item_id);

        INSERT INTO migrations (version, applied_at) VALUES (3, ${Date.now()});
    `);
    console.log('[Database] Migration V3 applied');
}

/**
 * Migration V4: Vector embeddings for Local RAG
 */
async function migrateV4(database: SQLite.SQLiteDatabase): Promise<void> {
    await database.execAsync(`
        -- Vectors table
        CREATE TABLE IF NOT EXISTS vectors (
            id TEXT PRIMARY KEY, -- usually source_id
            source_type TEXT NOT NULL,
            content TEXT NOT NULL,
            embedding TEXT NOT NULL, -- JSON string of float array
            metadata TEXT, -- JSON string
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_vectors_source ON vectors(source_type);

        INSERT INTO migrations (version, applied_at) VALUES (4, ${Date.now()});
    `);
    console.log('[Database] Migration V4 applied');
}

/**
 * Migration V5: External ID for events to prevent duplication
 */
async function migrateV5(database: SQLite.SQLiteDatabase): Promise<void> {
    await database.execAsync(`
        -- Add external_id to events
        ALTER TABLE events ADD COLUMN external_id TEXT;

        -- Index for looking up events by source and external ID
        CREATE INDEX IF NOT EXISTS idx_events_external ON events(source_id, external_id);

        INSERT INTO migrations (version, applied_at) VALUES (5, ${Date.now()});
    `);
    console.log('[Database] Migration V5 applied');
}

/**
 * Migration V6: Plugin chats for local plugin data storage
 */
async function migrateV6(database: SQLite.SQLiteDatabase): Promise<void> {
    await database.execAsync(`
        -- Plugin chats table
        CREATE TABLE IF NOT EXISTS plugin_chats (
            id TEXT PRIMARY KEY,
            plugin_name TEXT NOT NULL,
            record_type TEXT NOT NULL,
            source_id TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            data TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        -- Plugin messages table
        CREATE TABLE IF NOT EXISTS plugin_messages (
            id TEXT PRIMARY KEY,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (chat_id) REFERENCES plugin_chats(id) ON DELETE CASCADE
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_plugin_chats_plugin ON plugin_chats(plugin_name);
        CREATE INDEX IF NOT EXISTS idx_plugin_chats_source ON plugin_chats(source_id);
        CREATE INDEX IF NOT EXISTS idx_plugin_messages_chat ON plugin_messages(chat_id);

        INSERT INTO migrations (version, applied_at) VALUES (6, ${Date.now()});
    `);
    console.log('[Database] Migration V6 applied');
}

/**
 * Migration V7: GitHub repositories cache
 */
async function migrateV7(database: SQLite.SQLiteDatabase): Promise<void> {
    await database.execAsync(`
        CREATE TABLE IF NOT EXISTS github_repos_cache (
            id INTEGER NOT NULL,
            integrationId TEXT NOT NULL,
            name TEXT NOT NULL,
            full_name TEXT NOT NULL,
            description TEXT,
            html_url TEXT NOT NULL,
            stargazers_count INTEGER DEFAULT 0,
            language TEXT,
            updated_at TEXT NOT NULL,
            cachedAt INTEGER NOT NULL,
            PRIMARY KEY (id, integrationId)
        );

        CREATE INDEX IF NOT EXISTS idx_github_repos_integration ON github_repos_cache(integrationId);
        CREATE INDEX IF NOT EXISTS idx_github_repos_cached_at ON github_repos_cache(cachedAt);

        INSERT INTO migrations (version, applied_at) VALUES (7, ${Date.now()});
    `);
    console.log('[Database] Migration V7 applied');
}

/**
 * Migration V8: Drop local vectors table (RAG moved to backend)
 */
async function migrateV8(database: SQLite.SQLiteDatabase): Promise<void> {
    await database.execAsync(`
        DROP TABLE IF EXISTS vectors;

        INSERT INTO migrations (version, applied_at) VALUES (8, ${Date.now()});
    `);
    console.log('[Database] Migration V8 applied: vectors table removed');
}

/**
 * Migration V9: User-space separation — add user_id to integrations, briefings, plugin_chats
 */
async function migrateV9(database: SQLite.SQLiteDatabase): Promise<void> {
    await database.execAsync(`
        ALTER TABLE integrations ADD COLUMN user_id TEXT;
        ALTER TABLE briefings ADD COLUMN user_id TEXT;
        ALTER TABLE plugin_chats ADD COLUMN user_id TEXT;

        CREATE INDEX IF NOT EXISTS idx_integrations_user_id ON integrations(user_id);
        CREATE INDEX IF NOT EXISTS idx_briefings_user_id ON briefings(user_id);
        CREATE INDEX IF NOT EXISTS idx_plugin_chats_user_id ON plugin_chats(user_id);

        INSERT INTO migrations (version, applied_at) VALUES (9, ${Date.now()});
    `);
    console.log(
        '[Database] Migration V9 applied: user_id added for user-space separation',
    );
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
        DELETE FROM suggested_actions;
        DELETE FROM briefing_items;
        DELETE FROM briefings;
        DELETE FROM analyzed_emails;
        DELETE FROM events;
        DELETE FROM tasks;
        DELETE FROM generated_content;
        DELETE FROM emails;
        DELETE FROM integration_credentials;
        DELETE FROM integrations;
        DELETE FROM plugin_messages;
        DELETE FROM plugin_chats;
        DELETE FROM github_repos_cache;
    `);
    console.log('[Database] All data cleared');
}

/**
 * Reset the database completely (delete file and reinitialize)
 * This is useful when schema changes require a fresh start
 */
export async function resetDatabase(): Promise<void> {
    console.log('[Database] Resetting database...');

    // Close the connection first
    if (db) {
        await db.closeAsync();
        db = null;
    }

    // Delete the database file
    await SQLite.deleteDatabaseAsync(DATABASE_NAME);
    console.log('[Database] Database file deleted');

    // Reinitialize with fresh migrations
    await initDatabase();
    console.log('[Database] Database reset complete');
}
