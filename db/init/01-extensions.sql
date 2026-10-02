-- Runs once, the first time the Docker volume is created.
-- The app database gets pgvector. A second database is created for tests.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE DATABASE askdocs_test;
\connect askdocs_test
CREATE EXTENSION IF NOT EXISTS vector;
