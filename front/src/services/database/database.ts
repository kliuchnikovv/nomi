import * as SQLite from 'expo-sqlite';

export const getDatabase = async () => {
  const db = await SQLite.openDatabaseAsync('app.db');
  return db;
};

export const initDatabase = async () => {
  const db = await getDatabase();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);

  // Integrations table
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      account_email TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);

  // Credentials table
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS integration_credentials (
      integration_id TEXT PRIMARY KEY,
      access_token TEXT,
      refresh_token TEXT,
      token_expiry INTEGER,
      client_id TEXT,
      extra_data TEXT,
      FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
    );
  `);

  // Cache table
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS integration_cache (
      id TEXT PRIMARY KEY,
      integration_id TEXT,
      data_type TEXT,
      data TEXT,
      fetched_at INTEGER,
      expires_at INTEGER,
      FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
    );
  `);

  console.log('Database initialized');
};
