CREATE TABLE "query_embeddings" (
	"org_id" uuid NOT NULL,
	"model" text NOT NULL,
	"text_hash" text NOT NULL,
	"embedding" halfvec(2048) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "query_embeddings_org_id_model_text_hash_pk" PRIMARY KEY("org_id","model","text_hash")
);
--> statement-breakpoint
ALTER TABLE "query_embeddings" ADD CONSTRAINT "query_embeddings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;