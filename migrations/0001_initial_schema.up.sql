CREATE TABLE ai.agno_sessions
(
    session_id    VARCHAR NOT NULL
        CONSTRAINT agno_sessions_uq_session_id UNIQUE,
    session_type  VARCHAR NOT NULL,
    agent_id      VARCHAR,
    team_id       VARCHAR,
    workflow_id   VARCHAR,
    user_id       VARCHAR,
    session_data  JSON,
    agent_data    JSON,
    team_data     JSON,
    workflow_data JSON,
    metadata      JSON,
    runs          JSON,
    summary       JSON,
    created_at    BIGINT NOT NULL,
    updated_at    BIGINT
);

CREATE TABLE oauth_tokens (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id         text      NOT NULL,
  provider           text      NOT NULL,        -- "google"
  account_email      text      NOT NULL,
  external_user_id   text      NOT NULL,        -- sub из id_token
  scopes             text[]    NOT NULL,
  token_encrypted    bytea     NOT NULL,        -- envelope: [len|wrapped_dek|nonce|ciphertext]
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            int       NOT NULL DEFAULT 0,
  deleted_at         timestamptz
);

-- Аудит (легкий)
CREATE TABLE audit_security (
  id          bigserial PRIMARY KEY,
  profile_id  text,
  provider    text,
  action      text NOT NULL,      -- UPSERT, READ, ROTATE, REVOKE, REFRESH
  token_id    uuid,
  at          timestamptz NOT NULL DEFAULT now(),
  meta        jsonb
);

CREATE TABLE integration_logs (
    id          bigserial PRIMARY KEY,
    profile_id  text NOT NULL,
    provider    text NOT NULL,
    agent_id    text NOT NULL,
    action      text NOT NULL,
    timestamp   TIMESTAMPTZ NOT NULL,
    details     JSONB
);


ALTER TABLE ai.agno_sessions
    OWNER TO postgres;

CREATE INDEX idx_agno_sessions_session_type
    ON ai.agno_sessions (session_type);

CREATE INDEX idx_agno_sessions_created_at
    ON ai.agno_sessions (created_at);

CREATE UNIQUE INDEX ux_oauth_identity
  ON oauth_tokens (provider, profile_id, account_email)
  WHERE deleted_at IS NULL;
