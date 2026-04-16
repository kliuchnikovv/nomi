# Gmail & Calendar Server Token Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move Gmail and Calendar OAuth tokens from plaintext `integrations.params` to the encrypted `oauth_tokens` PostgreSQL table, and switch Calendar execution from hybrid to server-side.

**Architecture:** Add AES-256-GCM encryption in `api/internal/crypto/`. `CallbackMobile` saves tokens encrypted to `oauth_tokens` instead of `integrations.params`. `ListTools` reads and decrypts from `oauth_tokens` to pass credentials to Python. Calendar manifest changes from `hybrid` to `server`.

**Tech Stack:** Go (crypto/aes, crypto/cipher), PostgreSQL (`oauth_tokens` table, already exists), React Native/TypeScript (mobile context).

---

### Task 1: Add EncryptionKey to config

**Files:**
- Modify: `api/internal/config/config.go`

**Step 1: Add `EncryptionKey` field to the `Token` struct**

```go
Token struct {
    RefreshBeforeMinutes int    `yaml:"refresh_before_minutes"`
    JWTSecret            string `yaml:"jwt_secret"`
    EncryptionKey        string `yaml:"encryption_key"` // hex-encoded 32-byte AES-256 key
} `yaml:"token"`
```

**Step 2: Verify it compiles**

```bash
cd api && go build ./...
```

Expected: no errors.

**Step 3: Add key to config file**

In `config/config.yaml` (or `.env.example`), add under `token:`:

```yaml
token:
  encryption_key: ${ENCRYPTION_KEY}
```

`ENCRYPTION_KEY` must be a 64-character hex string (32 bytes). Generate one:

```bash
openssl rand -hex 32
```

**Step 4: Commit**

```bash
git add api/internal/config/config.go config/config.yaml
git commit -m "feat: add EncryptionKey to token config for AES-256-GCM"
```

---

### Task 2: Create AES-256-GCM crypto package

**Files:**
- Create: `api/internal/crypto/aes.go`
- Create: `api/internal/crypto/aes_test.go`

**Step 1: Write the failing test**

```go
// api/internal/crypto/aes_test.go
package crypto_test

import (
    "testing"

    "github.com/kliuchnikovv/genie-api/internal/crypto"
)

func TestEncryptDecryptRoundtrip(t *testing.T) {
    key := make([]byte, 32) // all-zero key for test
    plaintext := []byte(`{"access_token":"tok","refresh_token":"ref"}`)

    ciphertext, err := crypto.Encrypt(key, plaintext)
    if err != nil {
        t.Fatalf("Encrypt failed: %v", err)
    }
    if len(ciphertext) == 0 {
        t.Fatal("expected non-empty ciphertext")
    }

    got, err := crypto.Decrypt(key, ciphertext)
    if err != nil {
        t.Fatalf("Decrypt failed: %v", err)
    }
    if string(got) != string(plaintext) {
        t.Errorf("expected %q, got %q", plaintext, got)
    }
}

func TestEncryptProducesUniqueOutput(t *testing.T) {
    key := make([]byte, 32)
    plaintext := []byte("same plaintext")

    a, _ := crypto.Encrypt(key, plaintext)
    b, _ := crypto.Encrypt(key, plaintext)

    if string(a) == string(b) {
        t.Error("expected different ciphertexts due to random nonce")
    }
}

func TestDecryptBadKey(t *testing.T) {
    key := make([]byte, 32)
    plaintext := []byte("hello")

    ct, _ := crypto.Encrypt(key, plaintext)

    wrongKey := make([]byte, 32)
    wrongKey[0] = 1
    _, err := crypto.Decrypt(wrongKey, ct)
    if err == nil {
        t.Error("expected error with wrong key")
    }
}
```

**Step 2: Run tests to confirm they fail**

```bash
cd api && go test ./internal/crypto/... -v
```

Expected: `cannot find package` or similar — package doesn't exist yet.

**Step 3: Implement the crypto package**

```go
// api/internal/crypto/aes.go
package crypto

import (
    "crypto/aes"
    "crypto/cipher"
    "crypto/rand"
    "errors"
    "io"
)

// Encrypt encrypts plaintext with AES-256-GCM using key.
// Returns nonce || ciphertext.
// key must be exactly 32 bytes.
func Encrypt(key, plaintext []byte) ([]byte, error) {
    block, err := aes.NewCipher(key)
    if err != nil {
        return nil, err
    }
    gcm, err := cipher.NewGCM(block)
    if err != nil {
        return nil, err
    }
    nonce := make([]byte, gcm.NonceSize())
    if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
        return nil, err
    }
    return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// Decrypt decrypts AES-256-GCM ciphertext produced by Encrypt.
// key must be exactly 32 bytes.
func Decrypt(key, ciphertext []byte) ([]byte, error) {
    block, err := aes.NewCipher(key)
    if err != nil {
        return nil, err
    }
    gcm, err := cipher.NewGCM(block)
    if err != nil {
        return nil, err
    }
    nonceSize := gcm.NonceSize()
    if len(ciphertext) < nonceSize {
        return nil, errors.New("ciphertext too short")
    }
    nonce, ct := ciphertext[:nonceSize], ciphertext[nonceSize:]
    return gcm.Open(nil, nonce, ct, nil)
}
```

**Step 4: Run tests to confirm they pass**

```bash
cd api && go test ./internal/crypto/... -v
```

Expected: all 3 tests PASS.

**Step 5: Commit**

```bash
git add api/internal/crypto/
git commit -m "feat: add AES-256-GCM encrypt/decrypt package"
```

---

### Task 3: Update `CallbackMobile` — save tokens to `oauth_tokens`

**Files:**
- Modify: `api/internal/handlers/oauth_mobile.go`
- Modify: `api/internal/server/server.go` (pass crypto key)

**Step 1: Add `cryptoKey` to `MobileOAuthHandler` and parse it in constructor**

In `oauth_mobile.go`, add the field and update `NewMobileOAuthHandler`:

```go
import (
    "encoding/hex"
    "github.com/kliuchnikovv/genie-api/internal/crypto"
    // ... existing imports
)

type MobileOAuthHandler struct {
    cfg          *config.Config
    storage      *storage.Storage
    logger       *zap.Logger
    oauthFactory *integrations.OAuthFactory
    oidcProvider *oidc.Provider
    cryptoKey    []byte // AES-256 key, 32 bytes
}

func NewMobileOAuthHandler(
    logger *zap.Logger,
    cfg *config.Config,
    db *storage.Storage,
) (*MobileOAuthHandler, error) {
    // ... existing factory/OIDC setup unchanged ...

    cryptoKey, err := hex.DecodeString(cfg.Token.EncryptionKey)
    if err != nil || len(cryptoKey) != 32 {
        return nil, fmt.Errorf("invalid encryption_key: must be 64 hex chars (32 bytes)")
    }

    return &MobileOAuthHandler{
        cfg:          cfg,
        storage:      db,
        logger:       logger,
        oauthFactory: oauthFactory,
        oidcProvider: oidcProvider,
        cryptoKey:    cryptoKey,
    }, nil
}
```

**Step 2: Update `MobileOAuthResponse` — remove token fields**

```go
// MobileOAuthResponse contains data returned to the mobile client after OAuth
type MobileOAuthResponse struct {
    AccountEmail string `json:"account_email"`
    Provider     string `json:"provider"`
}
```

Remove `AccessToken`, `RefreshToken`, `TokenExpiry` fields entirely.

**Step 3: Replace token-saving block in `CallbackMobile`**

Find the block starting at `// Return tokens to client WITHOUT saving...` and replace everything from there to the end of the handler:

```go
    // Encrypt and save tokens to oauth_tokens table
    type tokenPayload struct {
        AccessToken  string `json:"access_token"`
        RefreshToken string `json:"refresh_token,omitempty"`
        ClientID     string `json:"client_id,omitempty"`
        ClientSecret string `json:"client_secret,omitempty"`
        TokenURI     string `json:"token_uri,omitempty"`
        TokenType    string `json:"token_type,omitempty"`
    }
    payload := tokenPayload{
        AccessToken:  token.AccessToken,
        RefreshToken: token.RefreshToken,
        ClientID:     oauthConfig.ClientID,
        ClientSecret: oauthConfig.ClientSecret,
        TokenType:    token.TokenType,
    }
    // Determine token_uri by provider
    if providerName == "github" {
        payload.TokenURI = "https://github.com/login/oauth/access_token"
    } else {
        payload.TokenURI = "https://oauth2.googleapis.com/token"
    }

    payloadJSON, err := json.Marshal(payload)
    if err != nil {
        h.logger.Error("failed to marshal token payload", zap.Error(err))
        c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save credentials"})
        return
    }

    encrypted, err := crypto.Encrypt(h.cryptoKey, payloadJSON)
    if err != nil {
        h.logger.Error("failed to encrypt token", zap.Error(err))
        c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save credentials"})
        return
    }

    user, err := userFromCtxMobile(c.Request.Context())
    if err != nil || user == nil {
        h.logger.Warn("could not save tokens: user not found in context", zap.Error(err))
        c.JSON(http.StatusInternalServerError, gin.H{"error": "user not found"})
        return
    }

    oauthToken := &storage.OAuthToken{
        UserID:         user.ID,
        Provider:       providerName,
        AccountEmail:   accountEmail,
        TokenEncrypted: encrypted,
    }
    if err := h.storage.SaveOAuthToken(ctx, oauthToken); err != nil {
        h.logger.Error("failed to save oauth token", zap.Error(err))
        c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save credentials"})
        return
    }

    // Save integration metadata (no tokens in params)
    metaParams, _ := json.Marshal(map[string]string{"display_name": displayName})
    integration := &storage.Integration{
        UserID:       user.ID,
        Name:         accountEmail,
        Provider:     providerName,
        AccountEmail: accountEmail,
        Params:       string(metaParams),
        Enabled:      true,
        CreatedAt:    time.Now(),
        UpdatedAt:    time.Now(),
    }
    if err := h.storage.UpsertIntegration(integration); err != nil {
        h.logger.Error("failed to upsert integration", zap.Error(err))
    }

    h.logger.Info("mobile OAuth callback successful, tokens saved server-side",
        zap.String("provider", providerName),
        zap.String("email", accountEmail),
    )

    c.JSON(http.StatusOK, MobileOAuthResponse{
        AccountEmail: accountEmail,
        Provider:     providerName,
    })
```

**Step 4: Build to check for compile errors**

```bash
cd api && go build ./...
```

Expected: no errors. If `RefreshTokenRequest` or `RefreshTokenResponse` reference the old struct, update those too (they have their own structs, unaffected).

**Step 5: Commit**

```bash
git add api/internal/handlers/oauth_mobile.go
git commit -m "feat: save Gmail/Calendar tokens encrypted to oauth_tokens, strip from response"
```

---

### Task 4: Update `ListTools` — read tokens from `oauth_tokens`

**Files:**
- Modify: `api/internal/handlers/tools.go`
- Modify: `api/internal/server/server.go`

**Step 1: Add `cryptoKey` to `ToolsHandler`**

```go
type ToolsHandler struct {
    store     *storage.Storage
    logger    *zap.Logger
    cryptoKey []byte
}

func NewToolsHandler(store *storage.Storage, logger *zap.Logger, cryptoKey []byte) *ToolsHandler {
    return &ToolsHandler{
        store:     store,
        logger:    logger,
        cryptoKey: cryptoKey,
    }
}
```

**Step 2: Update `server.go` — parse key once, pass to both handlers**

In `api/internal/server/server.go`, where handlers are created:

```go
// Parse encryption key once
cryptoKey, err := hex.DecodeString(cfg.Token.EncryptionKey)
if err != nil || len(cryptoKey) != 32 {
    return fmt.Errorf("invalid encryption_key in config: %w", err)
}

// Pass to handlers
mobileOAuthH, err := handlers.NewMobileOAuthHandler(logger, cfg, ctr.Storage, cryptoKey)
// ...
toolsHandler = handlers.NewToolsHandler(ctr.Storage, logger, cryptoKey)
```

Update `NewMobileOAuthHandler` signature to accept `cryptoKey []byte` instead of deriving it internally (remove the hex decode from the handler constructor, it now comes from server.go).

**Step 3: Replace credential-building logic in `ListTools`**

Find the block where `entry.mergedParams[accountID] = rawParams` is set (inside the `StorageTypeServer || StorageTypeHybrid` check) and replace:

```go
// For server-side tools, load credentials from oauth_tokens (encrypted)
if provider.StorageType == integrations.StorageTypeServer || provider.StorageType == integrations.StorageTypeHybrid {
    oauthToken, err := h.store.GetOAuthTokenByUserAndEmail(
        c.Request.Context(), userID, integration.Provider, integration.AccountEmail,
    )
    if err != nil {
        h.logger.Warn("oauth token not found for integration, skipping credentials",
            zap.String("provider", integration.Provider),
            zap.String("account_email", integration.AccountEmail),
            zap.Error(err),
        )
    } else {
        decrypted, err := crypto.Decrypt(h.cryptoKey, oauthToken.TokenEncrypted)
        if err != nil {
            h.logger.Warn("failed to decrypt oauth token",
                zap.String("provider", integration.Provider),
                zap.Error(err),
            )
        } else {
            var tokenData map[string]interface{}
            if err := json.Unmarshal(decrypted, &tokenData); err == nil {
                entry.mergedParams[accountID] = tokenData
            }
        }
    }
}
```

Also add the import: `"github.com/kliuchnikovv/genie-api/internal/crypto"`

**Step 4: Remove old rawParams credential extraction**

Delete the block that reads `rawParams` from `integration.Params` for credentials (lines that do `json.Unmarshal([]byte(integration.Params), &rawParams)` and use it as credentials). Keep only the `displayName` derivation from `rawParams` if needed.

Actually `rawParams` is still needed for `displayName` fallback. Keep the unmarshal but don't use `rawParams` as credentials. After extracting `displayName`, `rawParams` is no longer used in the credentials path.

**Step 5: Build and test**

```bash
cd api && go build ./...
cd api && go test ./...
```

Expected: all pass.

**Step 6: Commit**

```bash
git add api/internal/handlers/tools.go api/internal/server/server.go
git commit -m "feat: ListTools reads credentials from encrypted oauth_tokens table"
```

---

### Task 5: Switch Calendar plugin to server-side

**Files:**
- Modify: `plugins/calendar/manifest.yaml`
- Modify: `plugins/calendar/client/executor.ts`

**Step 1: Update Calendar manifest**

Replace contents of `plugins/calendar/manifest.yaml`:

```yaml
name: calendar
display_name: Google Calendar
description: Google Calendar integration for calendar management
version: 1.0.0

execution:
  type: server
  entry_points:
    server: ./server/tools.py

auth:
  type: oauth2
  oauth_config_key: google
  oidc_issuer_url: https://accounts.google.com
  permissions:
    - calendar:read
    - calendar:write

ui:
  icon: calendar
  description_short: Google Calendar integration for calendar management
  category: calendar

methods:
  - name: get_upcoming_events
    description: Get upcoming events from the user's primary calendar
    parameters:
      type: object
      properties:
        max_results:
          type: integer
          default: 10
          description: Maximum number of events to return
      required: []
  - name: create_event
    description: Create a new calendar event
    parameters:
      type: object
      properties:
        summary:
          type: string
          description: Event title
        start_time:
          type: string
          description: ISO format start time
        end_time:
          type: string
          description: ISO format end time
      required: [summary, start_time, end_time]
  - name: list_calendars
    description: List user's calendars
    parameters:
      type: object
      properties: {}
      required: []

background_tasks:
  enabled: false

storage:
  type: server
  encrypted: true
```

**Step 2: Replace Calendar client executor with server stub**

Replace `plugins/calendar/client/executor.ts` contents:

```typescript
/**
 * Google Calendar client plugin: stub executor for server-only execution.
 * All Calendar operations are handled server-side via the Python tools.py.
 */

import type { ClientPluginHandler } from "@genie/front/plugins/clientRegistry";

export const calendarPlugin: ClientPluginHandler = {
  async execute(method: string, _params: Record<string, any>): Promise<string> {
    throw new Error(
      `Calendar method '${method}' should be executed server-side. ` +
        "Make sure the plugin is configured as server-only in manifest.yaml."
    );
  },
};
```

**Step 3: Build Go API (manifest is loaded at runtime, no compile step needed)**

```bash
cd api && go build ./...
```

**Step 4: Type-check frontend**

```bash
cd front && npm run type-check
```

Expected: no errors.

**Step 5: Commit**

```bash
git add plugins/calendar/manifest.yaml plugins/calendar/client/executor.ts
git commit -m "feat: switch Calendar plugin from hybrid to server-side execution"
```

---

### Task 6: Update mobile OAuth callback — handle server integration response

**Files:**
- Modify: `front/src/screens/settings/connectors/context.tsx`

**Step 1: Update `exchangeCodeForTokens` to handle missing token fields**

In `exchangeCodeForTokens`, replace the `createIntegration` call (lines ~294-306) with:

```typescript
// For server integrations, tokens are stored server-side — no local credentials needed
const credentials = data.access_token
    ? {
        accessToken: data.access_token as string,
        refreshToken: data.refresh_token as string | undefined,
        tokenExpiry: data.token_expiry
            ? new Date((data.token_expiry as number) * 1000)
            : undefined,
      }
    : { accessToken: '' };

await integrationStorage.createIntegration({
    provider: data.provider as LocalIntegration['provider'],
    name: `${displayName} (${data.account_email})`,
    enabled: true,
    accountEmail: data.account_email,
    storageType: metadata?.storageType,
    supportsBackgroundTasks: metadata?.supportsBackgroundTasks,
    systemEventListeners: metadata?.systemEventListeners,
}, credentials);
```

**Step 2: Type-check**

```bash
cd front && npm run type-check
```

Expected: no errors.

**Step 3: Commit**

```bash
git add front/src/screens/settings/connectors/context.tsx
git commit -m "feat: mobile OAuth callback handles server-side token storage gracefully"
```

---

### Task 7: Final verification

**Step 1: Full Go build and tests**

```bash
cd api && go build ./... && go test ./...
```

Expected: all pass.

**Step 2: Frontend type check**

```bash
cd front && npm run type-check
```

Expected: no errors.

**Step 3: Python lint**

```bash
cd back && ruff check .
```

Expected: no errors.

**Step 4: Commit if anything was adjusted**

```bash
git add -p
git commit -m "fix: post-migration cleanup"
```

---

## Manual Testing Checklist

After deployment:

1. Connect Gmail via OAuth → confirm integration shows in UI, no tokens in `integrations.params`, row exists in `oauth_tokens`
2. Connect Calendar via OAuth → same as above
3. Send a chat message that uses Gmail (e.g. "read my last email") → Python receives credentials, GmailTools works
4. Re-connect same Gmail account → `oauth_tokens` row updated (upsert via `SaveOAuthToken`)
5. Existing users (with old plaintext tokens in `integrations.params`) → won't have `oauth_tokens` row → `ListTools` logs warning, tools not available → user must re-authenticate
