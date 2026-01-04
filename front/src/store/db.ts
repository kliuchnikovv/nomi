import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('app.db');

export const initDatabase = () => {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      credentials TEXT,
      enabled INTEGER DEFAULT 0
    );
  `);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS cache_data (
      type TEXT PRIMARY KEY,
      data TEXT,
      updated_at TEXT
    );
  `);
};

export const getIntegration = (type: string) => {
    const result = db.getAllSync('SELECT * FROM integrations WHERE type = ?', [type]);
    return result[0];
}

export const saveIntegration = (type: string, credentials: any, enabled: boolean) => {
    const jsonCreds = JSON.stringify(credentials);
    // Check if exists
    const existing = getIntegration(type);
    if (existing) {
        db.runSync('UPDATE integrations SET credentials = ?, enabled = ? WHERE type = ?', [jsonCreds, enabled ? 1 : 0, type]);
    } else {
        db.runSync('INSERT INTO integrations (id, type, credentials, enabled) VALUES (?, ?, ?, ?)', [type, type, jsonCreds, enabled ? 1 : 0]);
    }
}

export const getCache = (type: string) => {
    const result = db.getAllSync('SELECT * FROM cache_data WHERE type = ?', [type]);
    return result[0] ? JSON.parse((result[0] as any).data) : null;
}

export const saveCache = (type: string, data: any) => {
    const jsonData = JSON.stringify(data);
    const now = new Date().toISOString();
    const existing = db.getAllSync('SELECT * FROM cache_data WHERE type = ?', [type]);

    if (existing.length > 0) {
        db.runSync('UPDATE cache_data SET data = ?, updated_at = ? WHERE type = ?', [jsonData, now, type]);
    } else {
        db.runSync('INSERT INTO cache_data (type, data, updated_at) VALUES (?, ?, ?)', [type, jsonData, now]);
    }
}

export const getAllCache = () => {
    const results = db.getAllSync('SELECT * FROM cache_data');
    const cache: Record<string, any> = {};
    results.forEach((row: any) => {
        cache[row.type] = JSON.parse(row.data);
    });
    return cache;
}
