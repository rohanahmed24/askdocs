DROP INDEX "chunks_embedding_hnsw_idx";--> statement-breakpoint
-- Vectors of another size cannot be converted. Remove them and queue the documents
-- again, so the worker embeds them with the new model. (No real data exists yet.)
DELETE FROM "chunks";--> statement-breakpoint
UPDATE "documents" SET "status" = 'queued', "chunk_count" = 0, "error" = NULL WHERE "status" = 'ready';--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "embedding" SET DATA TYPE halfvec(2048);--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw_idx" ON "chunks" USING hnsw ("embedding" halfvec_cosine_ops);
