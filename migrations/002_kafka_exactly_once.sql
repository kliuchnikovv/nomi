-- Tracks processed Kafka messages to achieve effectively-once delivery
-- Unique constraint ensures a message is only processed once
CREATE TABLE IF NOT EXISTS kafka_processed_messages (
    id                BIGSERIAL PRIMARY KEY,
    topic             TEXT        NOT NULL,
    partition         INT         NOT NULL,
    offset            BIGINT      NOT NULL,
    message_key       TEXT,
    message_id        TEXT,
    processed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (topic, partition, offset),
    UNIQUE (message_id)
);

