# Research Assistant — Application Specification

## Overview

A personal, local-only research assistant. A Chrome extension captures web pages and posts them to a backend API, which chunks and indexes the content in PostgreSQL (pgvector + full-text search). A minimal TanStack Start UI provides hybrid search over everything saved.

**Goal:** prove the idea quickly. Keep it simple. Enhancements come later.

---

## Architecture

```
[Chrome Extension] --POST html+metadata--> [Bun API]
                                               |
                                  ┌────────────┴────────────┐
                                  ▼                         ▼
                           [chunks table]           [documents table]
                         (vector + tsvector)        (metadata, hash)
                                  └────────────┬────────────┘
                                               ▼
                                       [TanStack Start UI]
                                        (hybrid search)
```

**Data flow:** Browser → Extension → `POST /api/ingest` → chunk + embed + persist → search UI → hybrid query → results with snippets + source links.

---

## Deployment — Docker Compose (local only)

All services run locally via `docker-compose`. No public exposure.

```yaml
# docker-compose.yml (outline)
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: researcher
      POSTGRES_USER: researcher
      POSTGRES_PASSWORD: researcher
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql

  api:
    build: ./api
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://researcher:researcher@db:5432/researcher
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    depends_on:
      - db

  web:
    build: ./web
    ports:
      - "3000:3000"
    environment:
      API_BASE_URL: http://localhost:3001
    depends_on:
      - api

volumes:
  pgdata:
```

**Port conventions:**
- `http://localhost:3000` — web UI
- `http://localhost:3001` — API

---

## Components

### 1. Frontend — TanStack Start

- File-based routing, no authentication
- **Pages:**
  - `/` — Search (primary view)
  - `/saved` — Browse saved documents (secondary, optional)

**Search page:**
- Single search input, submit → `GET /api/search?q=...`
- Results as cards showing:
  - Matched text chunk
  - Page title
  - Clickable source URL (opens in new tab)
  - Saved timestamp
  - Match type badge (`fts` / `vector` / `both`)
- Clear empty state and error state messages

---

### 2. Backend API — Bun + Hono

- **Runtime:** Bun
- **Framework:** Hono (lightweight, first-class Bun support)
- **CORS:** Allow `http://localhost:3000` and `chrome-extension://*` only

#### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/ingest` | Accept HTML + metadata, chunk, embed, store |
| `GET` | `/api/search?q=` | Hybrid search, return ranked chunks |
| `GET` | `/api/documents` | List saved documents (for `/saved` page) |

---

#### `POST /api/ingest`

```json
{
  "url": "https://example.com/article",
  "title": "Article Title",
  "doi": "10.1234/example.doi",   // optional — used as idempotency key when present
  "capturedAt": "2026-04-06T12:00:00Z",  // optional, defaults to now()
  "html": "<html>...</html>"
}
```

**Idempotency:**
- If `doi` is present, use it as the document identity key (preferred — DOIs are stable across URL changes)
- Otherwise fall back to `url` as the key
- Compute a `content_hash` (SHA-256 of extracted plain text) on ingest
- If the hash matches the stored hash → return early, skip re-embedding (no-op)
- If hash differs (page updated) → delete old chunks and re-ingest

**Processing pipeline:**
1. Extract plain text and title from HTML (strip tags, collapse whitespace)
2. Check idempotency (DOI or URL + content hash) — skip if unchanged
3. Upsert document row in `documents`
4. Delete existing chunks for this document (if re-ingesting)
5. Split text into chunks (~500 tokens, ~50 token overlap)
6. Embed chunks in batches via OpenAI `text-embedding-3-small`
7. Insert chunks into `chunks` with embedding + `tsvector`

```json
// Response
{ "ok": true, "status": "ingested", "chunks": 12 }
// or
{ "ok": true, "status": "skipped", "reason": "content unchanged" }
```

---

#### `GET /api/search?q=<query>&limit=20`

1. Embed query with same model as ingest
2. Vector search: cosine similarity via pgvector (`<=>` operator), top-k
3. FTS search: `websearch_to_tsquery('english', $query)` + `ts_rank`, top-k
4. Merge: reciprocal rank fusion on the two lists, deduplicate by `chunk_id`
5. Return top results with source metadata

```json
{
  "results": [
    {
      "chunkId": "uuid",
      "text": "...matched chunk text...",
      "documentUrl": "https://example.com/article",
      "documentTitle": "Article Title",
      "doi": "10.1234/example.doi",
      "savedAt": "2026-04-06T12:00:00Z",
      "score": 0.91,
      "matchType": "vector" | "fts" | "both"
    }
  ]
}
```

---

### 3. Chrome Extension — Manifest V3

- **Permissions:** `activeTab`, `scripting`
- **UI:** Popup with current page URL and a "Save Page" button

**Behaviour:**
1. User clicks extension icon
2. Popup shows URL and "Save Page" button
3. Content script reads `document.documentElement.outerHTML`
4. Extension attempts to extract DOI from page meta tags (e.g. `<meta name="citation_doi">`, `<meta name="dc.identifier">`) and includes it if found
5. POSTs `{ url, title, doi?, capturedAt, html }` to `http://localhost:3001/api/ingest`
6. Popup shows "Saved!" or error message

**API URL:** hardcoded to `http://localhost:3001` (local-only tool, no options page needed for v1).

---

## Database Schema

```sql
-- db/init.sql

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid()

CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url          TEXT NOT NULL,
  doi          TEXT,                        -- null if not available
  title        TEXT,
  content_hash TEXT NOT NULL,              -- SHA-256 of plain text; used for skip-if-unchanged
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT documents_doi_unique  UNIQUE (doi),   -- partial: only enforced when doi IS NOT NULL
  CONSTRAINT documents_url_unique  UNIQUE (url)
);

-- Use DOI as primary key if present, else URL
CREATE UNIQUE INDEX documents_doi_unique_idx ON documents (doi) WHERE doi IS NOT NULL;

CREATE TABLE chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal     INTEGER NOT NULL,
  text        TEXT NOT NULL,
  tsv         TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
  embedding   VECTOR(1536),               -- matches text-embedding-3-small
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX chunks_document_id_idx ON chunks (document_id);
CREATE INDEX chunks_tsv_idx         ON chunks USING GIN (tsv);
CREATE INDEX chunks_embedding_idx   ON chunks USING HNSW (embedding vector_cosine_ops);
```

> `tsv` is a **generated column** — Postgres keeps it in sync automatically; no trigger needed.

---

## Embedding

| Setting | Value |
|---------|-------|
| Provider | OpenAI |
| Model | `text-embedding-3-small` |
| Dimensions | 1536 |
| Batching | Up to 100 chunks per API call |
| Key | `OPENAI_API_KEY` env var (server-side only, never in the extension) |

---

## CORS Policy

API allows only:
- `http://localhost:3000` (web UI)
- `chrome-extension://*` (extension origin, required for browser POSTs)

All other origins are rejected. No credentials/cookies needed.

---

## Environment Variables

```env
# .env (host machine — passed into docker-compose)
OPENAI_API_KEY=sk-...

# Set automatically by docker-compose, not needed in .env
DATABASE_URL=postgresql://researcher:researcher@db:5432/researcher
API_BASE_URL=http://localhost:3001
```

---

## Project Structure

```
/
├── docker-compose.yml
├── .env
├── db/
│   └── init.sql
├── api/                  # Bun + Hono
│   ├── Dockerfile
│   └── src/
│       ├── index.ts
│       ├── ingest.ts
│       ├── search.ts
│       └── db.ts
├── web/                  # TanStack Start
│   ├── Dockerfile
│   └── src/
│       └── routes/
│           ├── index.tsx     # search page
│           └── saved.tsx
└── extension/            # Chrome MV3
    ├── manifest.json
    ├── popup.html
    ├── popup.js
    └── content.js
```

---

## Local Development Setup

```bash
cp .env.example .env          # add OPENAI_API_KEY
docker compose up --build     # starts db, api, web
```

Then load `/extension` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| DOI as idempotency key | DOIs are permanent identifiers; URLs change (redirects, CDN). Fall back to URL for non-academic pages. |
| `content_hash` skip | Avoids redundant embedding API calls when re-saving an unchanged page. |
| Generated `tsv` column | Postgres maintains it automatically — no application code or trigger needed. |
| Bun + Hono | Fast startup, minimal config, TypeScript-native. |
| HNSW index | Better query performance than IVFFlat for this scale; pgvector supports it from v0.5. |
| No auth | Local-only tool; Docker network + localhost binding is sufficient isolation for v1. |
| Simplicity first | No job queues, no versioning, no multi-user. Replace chunks on re-ingest. Enhance later. |
