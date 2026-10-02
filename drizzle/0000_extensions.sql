-- pgvector powers similarity search over chunk embeddings.
-- Neon and other managed Postgres hosts need the extension created explicitly.
CREATE EXTENSION IF NOT EXISTS vector;
