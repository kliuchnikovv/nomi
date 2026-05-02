ALTER TABLE users
ADD COLUMN IF NOT EXISTS agent_storage_mode VARCHAR NOT NULL DEFAULT 'payload';
-- valid values: 'payload' | 'agno'
