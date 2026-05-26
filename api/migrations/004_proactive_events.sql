-- Migration 004: Proactive events storage foundation
-- Adds proactive_events table, per-user Updates chat, and reactive-agent columns.

BEGIN;

-- ── 1. Alter chats: add chat_type ─────────────────────────────────────────────
ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS chat_type TEXT NOT NULL DEFAULT 'standard';

-- ── 2. Alter users: add proactive / quiet-hours / updates-chat columns ─────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS updates_chat_id    UUID NULL REFERENCES chats(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quiet_hours_start  TIME NULL,
  ADD COLUMN IF NOT EXISTS quiet_hours_end    TIME NULL,
  ADD COLUMN IF NOT EXISTS proactive_enabled  BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 3. New table: proactive_events ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proactive_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source           TEXT        NOT NULL,   -- 'calendar' | 'email'
  event_type       TEXT        NOT NULL,   -- 'calendar_upcoming' | 'email_new'
  payload          JSONB       NOT NULL,
  fire_at          TIMESTAMPTZ NULL,
  state            TEXT        NOT NULL DEFAULT 'pending',
    -- 'pending' | 'rules_rejected' | 'judge_rejected' | 'surfaced' | 'dismissed' | 'discussed'
  decision_reason  TEXT        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at     TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_proactive_events_user_state
  ON proactive_events (user_id, state);

CREATE INDEX IF NOT EXISTS idx_proactive_events_state_fire_at
  ON proactive_events (state, fire_at);

-- ── 4. Backfill: create an Updates chat for every existing user that lacks one ──
DO $$
DECLARE
  r RECORD;
  new_chat_id UUID;
BEGIN
  FOR r IN
    SELECT id FROM users WHERE updates_chat_id IS NULL AND deleted_at IS NULL
  LOOP
    INSERT INTO chats (id, user_id, model, title, mode, type, chat_type, icon, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      r.id,
      'glm-5',
      'Updates',
      'agent',
      'regular',
      'updates',
      '',
      now(),
      now()
    )
    RETURNING id INTO new_chat_id;

    UPDATE users SET updates_chat_id = new_chat_id WHERE id = r.id;
  END LOOP;
END;
$$;

COMMIT;
