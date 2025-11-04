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

ALTER TABLE ai.agno_sessions
    OWNER TO postgres;

CREATE INDEX idx_agno_sessions_session_type
    ON ai.agno_sessions (session_type);

CREATE INDEX idx_agno_sessions_created_at
    ON ai.agno_sessions (created_at);