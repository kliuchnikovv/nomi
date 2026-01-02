-- Enable PgVector extension for Agno RAG
-- This extension provides vector similarity search capabilities

CREATE EXTENSION IF NOT EXISTS vector;

-- Verify the extension is installed
SELECT * FROM pg_extension WHERE extname = 'vector';
