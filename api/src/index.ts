import { Hono } from "hono";
import { cors } from "hono/cors";
import { handleIngest } from "./ingest.js";
import { handleSearch } from "./search.js";
import { summarizeDocument } from "./summarize.js";
import sql from "./db.js";
import {
  handleGetSections,
  handleCreateSection,
  handleGetSection,
  handleUpdateSection,
  handleDeleteSection,
  handleMoveSection,
  handleGetSectionDocuments,
  handleLinkDocument,
  handleUnlinkDocument,
} from "./sections.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return null;
      if (
        origin === "http://localhost:3000" ||
        origin.startsWith("chrome-extension://")
      ) {
        return origin;
      }
      return null;
    },
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

app.post("/api/ingest", handleIngest);
app.get("/api/search", handleSearch);

// Collections
app.get("/api/collections", async (c) => {
  const collections = await sql`
    SELECT id, name, created_at FROM collections ORDER BY created_at ASC
  `;
  return c.json({ collections });
});

app.post("/api/collections", async (c) => {
  let body: { name: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const name = body.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);
  const [col] = await sql`
    INSERT INTO collections (name) VALUES (${name}) RETURNING id, name, created_at
  `;
  return c.json({ collection: col }, 201);
});

app.patch("/api/collections/:id", async (c) => {
  const { id } = c.req.param();
  let body: { name: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const name = body.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);
  const result = await sql`
    UPDATE collections SET name = ${name} WHERE id = ${id} RETURNING id, name, created_at
  `;
  if (result.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ collection: result[0] });
});

app.get("/api/reprocess", async (c) => {
  console.log("Reprocessing summaries");
  const docs = await sql<{ id: string }[]>`
    SELECT d.id
    FROM documents d
    WHERE d.summary IS NULL
      AND EXISTS (SELECT 1 FROM chunks WHERE document_id = d.id)
  `;

  if (docs.length === 0) {
    return c.json({ ok: true, processed: 0, message: "All documents already have summaries" });
  }

  await Promise.all(
    docs.map(async ({ id }) => {
      const chunks = await sql<{ text: string }[]>`
        SELECT text FROM chunks WHERE document_id = ${id} ORDER BY ordinal
      `;
      const text = chunks.map((ch) => ch.text).join(" ");
      await summarizeDocument(id, text);
    })
  );

  return c.json({ ok: true, processed: docs.length });
});

app.get("/api/documents/lookup", async (c) => {
  const url = c.req.query("url");
  const doi = c.req.query("doi");

  if (!url && !doi) return c.json({ error: "url or doi required" }, 400);

  let doc;
  if (doi) {
    [doc] = await sql`
      SELECT id, url, title, updated_at FROM documents WHERE doi = ${doi}
    `;
  }
  if (!doc && url) {
    [doc] = await sql`
      SELECT id, url, title, updated_at FROM documents WHERE url = ${url}
    `;
  }

  if (!doc) return c.json({ found: false });
  return c.json({ found: true, document: doc });
});

app.get("/api/documents", async (c) => {
  const collectionsParam = c.req.query("collections");
  const collectionIds = collectionsParam ? collectionsParam.split(",").filter(Boolean) : [];

  const docs = collectionIds.length > 0
    ? await sql`
        SELECT id, url, doi, title, summary, authors, published_at, captured_at, updated_at, collection_id
        FROM documents
        WHERE collection_id = ANY(${sql.array(collectionIds)}::uuid[])
        ORDER BY updated_at DESC
        LIMIT 100
      `
    : await sql`
        SELECT id, url, doi, title, summary, authors, published_at, captured_at, updated_at, collection_id
        FROM documents
        ORDER BY updated_at DESC
        LIMIT 100
      `;

  return c.json({ documents: docs });
});

app.get("/api/documents/:id", async (c) => {
  const { id } = c.req.param();
  const [doc] = await sql`
    SELECT id, url, doi, title, summary, authors, published_at, captured_at, updated_at, collection_id
    FROM documents WHERE id = ${id}
  `;
  if (!doc) return c.json({ error: "Not found" }, 404);
  const chunks = await sql`
    SELECT id, ordinal, text FROM chunks WHERE document_id = ${id} ORDER BY ordinal
  `;
  return c.json({ document: doc, chunks });
});

app.delete("/api/documents/:id", async (c) => {
  const { id } = c.req.param();
  const result = await sql`DELETE FROM documents WHERE id = ${id} RETURNING id`;
  if (result.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// Sections
app.get("/api/sections",                                    handleGetSections);
app.post("/api/sections",                                   handleCreateSection);
app.get("/api/sections/:id",                                handleGetSection);
app.patch("/api/sections/:id",                              handleUpdateSection);
app.delete("/api/sections/:id",                             handleDeleteSection);
app.patch("/api/sections/:id/move",                         handleMoveSection);
app.get("/api/sections/:id/documents",                      handleGetSectionDocuments);
app.post("/api/sections/:id/documents",                     handleLinkDocument);
app.delete("/api/sections/:id/documents/:documentId",       handleUnlinkDocument);

app.get("/api/migrate", async (c) => {
  await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ`;
  await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS authors TEXT`;
  await sql`
    CREATE TABLE IF NOT EXISTS sections (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_id   UUID        REFERENCES sections(id) ON DELETE CASCADE,
      name        TEXT        NOT NULL,
      content     TEXT        NOT NULL DEFAULT '',
      position    INTEGER     NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS sections_parent_idx ON sections(parent_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS section_documents (
      section_id  UUID REFERENCES sections(id)  ON DELETE CASCADE,
      document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (section_id, document_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS section_documents_document_idx ON section_documents(document_id)`;
  return c.json({ ok: true, message: "Migration complete" });
});

app.get("/api/health", (c) => c.json({ ok: true }));


const port = Number(process.env.PORT ?? 3001);
console.log(`API listening on http://0.0.0.0:${port}`);

export default {
  port,
  fetch: app.fetch,
};
