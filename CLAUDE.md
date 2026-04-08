# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A local-only personal research assistant: a Chrome extension captures web pages, the API indexes them with OpenAI embeddings into PostgreSQL (pgvector), and a React frontend provides hybrid semantic + full-text search.

## Running the Stack

Everything runs via Docker Compose:

```bash
docker compose up        # start all services (db, api, web)
docker compose up --build  # rebuild after Dockerfile changes
```

Ports: **3000** = web (Vite), **3001** = API (Hono), **5432** = PostgreSQL.

To develop outside Docker (API only):
```bash
cd api && bun run dev    # hot-reload via --watch
```

To develop the frontend outside Docker:
```bash
cd web && npm run dev
```

Set `VITE_API_BASE_URL=http://localhost:3001` (defaults to that if unset).

## Environment

Copy `.env.example` to `.env` and fill in `OPENAI_API_KEY`. The API reads this at startup; Docker Compose passes it into the `api` container.

## No Tests, No Linting

There are no test files and no linter config in this project.

## Architecture

### API (`api/src/`, Bun + Hono)

- **`index.ts`** — Route registration and CORS (allows `localhost:3000` and `chrome-extension://*`). All route logic is delegated to handler functions.
- **`ingest.ts`** — `handleIngest()`: strips HTML, computes SHA-256 hash, checks idempotency (DOI preferred over URL), upserts the document, calls `summarizeDocument()`, embeds chunks via OpenAI, stores in DB.
- **`summarize.ts`** — `generateSummaryAndChunks()`: calls `gpt-4o-mini` with structured output (Zod schema) to produce a summary + 3-10 semantic chunks (100–400 words each). `summarizeDocument()` wraps this, updates the document record, returns chunks.
- **`search.ts`** — `handleSearch()`: embeds the query, runs vector search (cosine similarity, top 20) and FTS (`websearch_to_tsquery`, top 20) in parallel, merges with Reciprocal Rank Fusion (k=60), returns top 20 results.
- **`db.ts`** — Single `postgres` pool instance (max 10 connections) used across all handlers.

### Database Schema (`db/init.sql`)

Two tables:
- **`documents`** — `id`, `url` (unique), `doi` (unique when present), `title`, `summary`, `content_hash`, timestamps.
- **`chunks`** — `id`, `document_id` (FK → documents, cascade delete), `ordinal`, `text`, `tsv` (generated `tsvector`), `embedding vector(1536)`.

Indexes: GIN on `tsv` for FTS, HNSW on `embedding` for vector search, B-tree on `document_id`.

Idempotency: re-ingesting a page with the same DOI (or URL if no DOI) and identical content hash is a no-op.

### Frontend (`web/src/`, React + Vite + React Router)

Three pages routed from `main.tsx`:
- `/` → **SearchPage** — search input with autocomplete history (localStorage), deduplicates results by document URL, shows match type badges (`vector`/`fts`/`both`).
- `/saved` → **SavedPage** — lists all ingested documents.
- `/document/:id` → **DocumentPage** — shows full document with all chunks in order.

The API base URL is read from `import.meta.env.VITE_API_BASE_URL`.

### Chrome Extension (`extension/`)

Manifest V3. The popup captures the active tab's HTML and extracts DOI from common academic meta tags (`citation_doi`, `dc.identifier`, `prism.doi`, etc.) and `doi.org` links, then POSTs to `http://localhost:3001/api/ingest`.

## Key API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/ingest` | Body: `{url, html, title?, doi?}` |
| `GET` | `/api/search?q=` | Hybrid search, returns ranked chunks |
| `GET` | `/api/documents` | List all documents |
| `GET` | `/api/documents/:id` | Document + all chunks |
| `DELETE` | `/api/documents/:id` | Delete document (cascades to chunks) |
| `GET` | `/api/reprocess` | Re-summarize all documents (batch) |
