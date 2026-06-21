-- Drop the legacy `single_chat_mode` column.
--
-- Background: this column gated the single-chat experiment. As of
-- 2026-06-21 the multi-chat path was removed and the column is no longer
-- read or written by the application. GORM AutoMigrate cannot drop
-- columns, so this is a manual step for a maintenance window.
--
-- To apply:
--   psql $DB_DSN -f api/migrations/005_drop_single_chat_mode.sql

ALTER TABLE users DROP COLUMN IF EXISTS single_chat_mode;
