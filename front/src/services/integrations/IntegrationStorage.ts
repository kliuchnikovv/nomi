import { getDatabase } from '../database/database';
import * as SecureStore from 'expo-secure-store';
import { v4 as uuidv4 } from 'uuid';

export interface Integration {
  id: string;
  provider: 'gmail' | 'calendar' | 'github' | 'jules';
  name: string;
  enabled: boolean;
  accountEmail?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IntegrationCredentials {
  accessToken: string;
  refreshToken?: string;
  tokenExpiry?: Date;
  extraData?: Record<string, any>;
}

export class IntegrationStorage {

  async createIntegration(integration: Integration, credentials: IntegrationCredentials): Promise<void> {
    const db = await getDatabase();

    // Check if id exists, generate if not (though usually passed in)
    const id = integration.id || uuidv4();

    await db.runAsync(
      `INSERT INTO integrations (id, provider, name, enabled, account_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        integration.provider,
        integration.name,
        integration.enabled ? 1 : 0,
        integration.accountEmail || null,
        integration.createdAt.getTime(),
        integration.updatedAt.getTime()
      ]
    );

    await this.saveCredentials(id, credentials);
  }

  async getIntegrations(): Promise<Integration[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<any>('SELECT * FROM integrations ORDER BY created_at DESC');

    return rows.map(row => ({
      id: row.id,
      provider: row.provider,
      name: row.name,
      enabled: !!row.enabled,
      accountEmail: row.account_email,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }));
  }

  async getIntegration(id: string): Promise<Integration | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<any>('SELECT * FROM integrations WHERE id = ?', [id]);

    if (!row) return null;

    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      enabled: !!row.enabled,
      accountEmail: row.account_email,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  async updateIntegration(id: string, updates: Partial<Integration>): Promise<void> {
    const db = await getDatabase();

    const sets: string[] = [];
    const args: any[] = [];

    if (updates.name !== undefined) { sets.push('name = ?'); args.push(updates.name); }
    if (updates.enabled !== undefined) { sets.push('enabled = ?'); args.push(updates.enabled ? 1 : 0); }
    if (updates.accountEmail !== undefined) { sets.push('account_email = ?'); args.push(updates.accountEmail); }

    sets.push('updated_at = ?');
    args.push(Date.now());

    args.push(id);

    if (sets.length > 1) { // 1 because updated_at is always added
        await db.runAsync(`UPDATE integrations SET ${sets.join(', ')} WHERE id = ?`, args);
    }
  }

  async deleteIntegration(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM integrations WHERE id = ?', [id]);
    await SecureStore.deleteItemAsync(`creds_${id}`);
    await db.runAsync('DELETE FROM integration_cache WHERE integration_id = ?', [id]);
  }

  async getCredentials(integrationId: string): Promise<IntegrationCredentials | null> {
    const json = await SecureStore.getItemAsync(`creds_${integrationId}`);
    if (!json) return null;

    const data = JSON.parse(json);
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      tokenExpiry: data.tokenExpiry ? new Date(data.tokenExpiry) : undefined,
      extraData: data.extraData
    };
  }

  async updateCredentials(integrationId: string, credentials: IntegrationCredentials): Promise<void> {
     await this.saveCredentials(integrationId, credentials);
  }

  private async saveCredentials(integrationId: string, credentials: IntegrationCredentials) {
    const data = {
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      tokenExpiry: credentials.tokenExpiry ? credentials.tokenExpiry.getTime() : undefined,
      extraData: credentials.extraData
    };
    await SecureStore.setItemAsync(`creds_${integrationId}`, JSON.stringify(data));
  }

  async getCachedData(integrationId: string, dataType: string): Promise<any | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<any>(
      'SELECT data, expires_at FROM integration_cache WHERE integration_id = ? AND data_type = ?',
      [integrationId, dataType]
    );

    if (!row) return null;
    if (row.expires_at < Date.now()) return null;

    try {
      return JSON.parse(row.data);
    } catch (e) {
      return null;
    }
  }

  async setCachedData(integrationId: string, dataType: string, data: any, ttlSeconds: number): Promise<void> {
    const db = await getDatabase();
    const now = Date.now();
    const expires = now + (ttlSeconds * 1000);

    // SQLite upsert
    await db.runAsync(
      `INSERT OR REPLACE INTO integration_cache (id, integration_id, data_type, data, fetched_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        `${integrationId}_${dataType}`,
        integrationId,
        dataType,
        JSON.stringify(data),
        now,
        expires
      ]
    );
  }
}

export const integrationStorage = new IntegrationStorage();
