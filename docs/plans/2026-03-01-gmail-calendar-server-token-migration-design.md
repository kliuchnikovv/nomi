# Design: Gmail & Calendar Token Migration to PostgreSQL

**Date:** 2026-03-01
**Status:** Approved

## Goal

Unify OAuth token storage: move Gmail and Calendar tokens from plaintext `integrations.params` (PostgreSQL) + device SQLite to the dedicated `oauth_tokens` table (PostgreSQL, AES-256-GCM encrypted). Move execution from hybrid/client to fully server-side.

## Problem

- Gmail/Calendar tokens stored as plaintext JSON in `integrations.params` — security issue
- GitHub tokens use `oauth_tokens` (encrypted) — inconsistent
- Calendar execution still `hybrid` (partially on device); Gmail already `server` in manifest
- Mobile stores tokens in SQLite unnecessarily for server-side execution

## Approach: `oauth_tokens` + AES-256-GCM

### Section 1: Encryption (`api/internal/crypto/`)

New package with AES-256-GCM:
- `Encrypt(plaintext []byte) ([]byte, error)`
- `Decrypt(ciphertext []byte) ([]byte, error)`
- Key: 32-byte value from `config.yaml → encryption_key`
- Nonce: 12 bytes, prepended to ciphertext

Used for writing/reading `oauth_tokens.TokenEncrypted`.

### Section 2: Token Storage — `CallbackMobile` (Go API)

**Before:** tokens → `integrations.params` (plaintext) + returned to mobile.

**After:**
1. Token JSON (`access_token`, `refresh_token`, `client_id`, `client_secret`, `token_uri`) encrypted → saved to `oauth_tokens.TokenEncrypted`
2. `integrations.params` stores only metadata: `{"display_name": "user@gmail.com"}`
3. `MobileOAuthResponse` returns only `account_email` + `provider` (no token fields)

No migration script — existing users re-authenticate.

### Section 3: `ListTools` (Go API)

**Before:** reads plaintext tokens from `integrations.params`.

**After:** for each integration, queries `oauth_tokens` by `(user_id, provider, account_email)`, decrypts `TokenEncrypted`, extracts tokens, injects into `params["credentials"]` as before. Python receives the same structure.

### Section 4: Calendar Plugin

`plugins/calendar/manifest.yaml`:
- `execution.type`: `hybrid` → `server`
- `background_tasks.enabled`: `true` → `false`
- `storage.type`: `hybrid` → `server`

`plugins/calendar/client/executor.ts`: replace with stub that throws error (same pattern as Gmail).

### Section 5: Mobile

- `IntegrationStorage` OAuth callback for Gmail/Calendar: no longer saves `integration_credentials` to SQLite (no tokens in response)
- Still writes `integrations` row (provider, account_email, enabled) for UI state
- `BackgroundTaskManager`: disable Calendar background tasks

## Files Changed

| File | Change |
|------|--------|
| `api/internal/crypto/aes.go` | New: AES-256-GCM encrypt/decrypt |
| `api/internal/config/config.go` | Add `EncryptionKey` field |
| `api/internal/handlers/oauth_mobile.go` | Save to `oauth_tokens`, strip tokens from response |
| `api/internal/handlers/tools.go` | Read from `oauth_tokens` instead of `integrations.params` |
| `plugins/calendar/manifest.yaml` | `hybrid` → `server`, disable background tasks |
| `plugins/calendar/client/executor.ts` | Server stub |
| `front/src/services/integrations/IntegrationStorage.ts` | Remove credential storage for Gmail/Calendar |

## Non-Goals

- Migration of existing tokens (users re-authenticate)
- Changes to GitHub token flow
- Changes to iOS-native integrations (Contacts, Reminders, Health)
