/**
 * Database Migrations
 * 
 * This file contains the SQL schemas for each migration version.
 * Migrations are applied automatically by database.ts
 * 
 * To add a new migration:
 * 1. Increment DATABASE_VERSION in database.ts
 * 2. Add a new migrateVX function in database.ts
 * 3. Document the schema changes here
 */

/*
 * Migration V1 - Initial Schema
 * =============================
 * 
 * Tables:
 * - integrations: OAuth integrations (Gmail, etc.)
 * - integration_credentials: Encrypted tokens
 * - emails: Cached email data
 * - generated_content: AI-generated content (summaries, replies)
 * 
 * Schema:
 * 
 * integrations:
 *   - id: TEXT PRIMARY KEY (UUID)
 *   - provider: TEXT (gmail, calendar, github, jules)
 *   - name: TEXT (display name)
 *   - enabled: INTEGER (0/1)
 *   - account_email: TEXT
 *   - created_at: INTEGER (unix timestamp)
 *   - updated_at: INTEGER (unix timestamp)
 * 
 * integration_credentials:
 *   - integration_id: TEXT PRIMARY KEY (FK to integrations)
 *   - access_token: TEXT (encrypted)
 *   - refresh_token: TEXT (encrypted)
 *   - token_expiry: INTEGER (unix timestamp)
 * 
 * emails:
 *   - id: TEXT PRIMARY KEY (UUID)
 *   - integration_id: TEXT (FK to integrations)
 *   - gmail_id: TEXT (Gmail message ID)
 *   - thread_id: TEXT
 *   - subject: TEXT
 *   - snippet: TEXT (preview text)
 *   - from_email: TEXT
 *   - from_name: TEXT
 *   - to_emails: TEXT (JSON array)
 *   - date: INTEGER (unix timestamp)
 *   - labels: TEXT (JSON array)
 *   - body_text: TEXT
 *   - body_html: TEXT
 *   - is_read: INTEGER (0/1)
 *   - fetched_at: INTEGER (unix timestamp)
 * 
 * generated_content:
 *   - id: TEXT PRIMARY KEY (UUID)
 *   - integration_id: TEXT (FK to integrations)
 *   - source_type: TEXT (email_summary, email_reply, etc.)
 *   - source_id: TEXT (email_id, thread_id, etc.)
 *   - content: TEXT
 *   - created_at: INTEGER (unix timestamp)
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_DESCRIPTION = {
    version: 1,
    tables: ['integrations', 'integration_credentials', 'emails', 'generated_content'],
    createdAt: '2026-01-04',
};
