import { Hono } from "hono";
import { cors } from "hono/cors";
import { handleIngest } from "./ingest.js";
import { handleSearch } from "./search.js";
import { summarizeDocument } from "./summarize.js";
import sql from "./db.js";

// Migrate existing databases that predate the summary column
await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS summary TEXT`;

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
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

app.post("/api/ingest", handleIngest);
app.get("/api/search", handleSearch);

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

  // Fire off all summaries concurrently
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

app.get("/api/documents", async (c) => {
  const docs = await sql`
    SELECT id, url, doi, title, summary, captured_at, updated_at
    FROM documents
    ORDER BY updated_at DESC
    LIMIT 100
  `;
  return c.json({ documents: docs });
});

app.delete("/api/documents/:id", async (c) => {
  const { id } = c.req.param();
  const result = await sql`DELETE FROM documents WHERE id = ${id} RETURNING id`;
  if (result.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

app.get("/api/health", (c) => c.json({ ok: true }));

const port = Number(process.env.PORT ?? 3001);
console.log(`API listening on http://0.0.0.0:${port}`);

export default {
  port,
  fetch: app.fetch,
};
