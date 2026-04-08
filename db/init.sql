CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE collections (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO collections (name) VALUES ('Default');

CREATE TABLE documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id),
  url           TEXT NOT NULL,
  doi           TEXT,
  title         TEXT,
  summary       TEXT,
  content_hash  TEXT NOT NULL,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX documents_url_idx        ON documents (url);
CREATE UNIQUE INDEX documents_doi_idx        ON documents (doi) WHERE doi IS NOT NULL;
CREATE        INDEX documents_collection_idx ON documents (collection_id);

CREATE TABLE chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal     INTEGER NOT NULL,
  text        TEXT NOT NULL,
  tsv         TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
  embedding   VECTOR(1536),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX chunks_doc_idx   ON chunks (document_id);
CREATE INDEX chunks_tsv_idx   ON chunks USING GIN (tsv);
CREATE INDEX chunks_embed_idx ON chunks USING HNSW (embedding vector_cosine_ops);
