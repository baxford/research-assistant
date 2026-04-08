# Research Assistant

> **Work in Progress** — a self-hosted personal research assistant for collecting, organising, and searching journal articles and web pages.

## Why?

Research and writing of articles involves searching and reading a lot of journal articles. Some of them are useful, and some of them have information that will be useful later on! I always find myself with a huge number of tabs open and it's often difficult to get back to a specific article with the right information. This research assistant allows you to save documents to your local system which you can later search using a hybrid semantic/full-text search, making it easy to find and filter the articles that are relevant to your current work.

Collections allow you to catalog articles into relevant areas.

## How it works

Researcher lets you save pages you're reading (including paywalled journal articles you're already logged into) and search them later using hybrid **semantic + full-text search**.

A Chrome extension captures the page HTML directly from your browser — no need to fetch by URL, which means institutional logins and paywalled content work fine. 

The API sanitises the HTML, uses GPT-4o-mini (configurable) to produce a structured summary and multiple semantic chunks, embeds them with OpenAI's text-embedding-3-small, and stores everything in PostgreSQL with pgvector. 

The web frontend lets you search across all saved documents using cosine similarity over embeddings combined with full-text search (Reciprocal Rank Fusion).

Documents are organised into **collections** so you can keep separate topic areas tidy.

### Stack


| Layer             | Technology                                      |
| ----------------- | ----------------------------------------------- |
| Database          | PostgreSQL + pgvector                           |
| API               | Bun + Hono                                      |
| Frontend          | React + Vite                                    |
| Browser extension | Chrome (Manifest V3)                            |
| AI                | OpenAI (embeddings + GPT-4o-mini summarisation) |


---

## Setup

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- An [OpenAI API key](https://platform.openai.com/api-keys)
- Google Chrome (for the extension)

### 1. Clone the repo

```bash
git clone <repo-url>
cd Researcher
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and set your OpenAI API key:

```
OPENAI_API_KEY=sk-...
```

That's the only required value. The API reads it at startup and Docker Compose passes it into the container.

### 3. Start the stack

```bash
docker compose up --build
```

This starts three services:


| Service | Port | Description              |
| ------- | ---- | ------------------------ |
| `db`    | 5432 | PostgreSQL with pgvector |
| `api`   | 3001 | Bun/Hono REST API        |
| `web`   | 3000 | React frontend (Vite)    |


On subsequent starts (no code changes) you can omit `--build`:

```bash
docker compose up
```

---

## Installing the Chrome Extension

The extension is loaded as an unpacked extension — it is not published to the Chrome Web Store.

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `extension/` folder from this repository

The **Researcher** extension icon will appear in your toolbar. Pin it for easy access.

> The extension communicates with the API at `http://localhost:3001`. The API must be running before you try to save a page.

---

## Using the Web App

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Search

Search results for "noradrenaline dysregulation link to alzheimers"

The home page (`/`) provides a search box. Results are ranked using Reciprocal Rank Fusion over:

- **Vector search** — cosine similarity over OpenAI embeddings (semantic meaning)
- **Full-text search** — PostgreSQL `websearch_to_tsquery` (keyword matching)

Each result shows a match-type badge (`vector`, `fts`, or `both`) and the chunk text. Results are deduplicated by document.

### Saved Documents

The `/saved` page lists all ingested documents across all collections. Click a document to view its full text and all chunks in order.

### Saving a Page (Chrome Extension)

1. Navigate to the article or page you want to save (log in via your institution if needed)
2. Click the **Researcher** extension icon in the toolbar
3. Select a **collection** from the dropdown (or create a new one with "＋ New collection…")
4. Click **Save Page**

The extension captures the page HTML, extracts a DOI if present (from academic meta tags or `doi.org` links), and posts it to the API. The API will:

- Strip HTML to plain text
- Check for duplicate content (by DOI or URL + content hash) — re-saving identical content is a no-op
- Generate a summary and semantic chunks using GPT-4o-mini
- Embed each chunk and store it in the database

Use **Force re-index** if you want to overwrite a previously saved version of the page.

---

## Why a Browser Extension?

Many journal articles are behind paywalls or institutional login systems. Fetching content server-side via URL is not practical in these cases. The extension runs in your authenticated browser session and captures the rendered HTML directly, so you get the full article text regardless of access restrictions.

---

## Future Enhancements

- Enhanced search UI — filtering by collection, date range, and match type
- In-extension search — query your saved documents without opening the web app
- In-extension summarisation preview before saving
- Better document management — bulk delete, re-process, collection management in the web UI
- Export / backup of the database
- Support for additional embedding models

---

## Development

To work on the API outside Docker (with hot reload):

```bash
cd api && bun run dev
```

To work on the frontend outside Docker:

```bash
cd web && bun run dev
```

Set `VITE_API_BASE_URL=http://localhost:3001` if needed (this is the default).