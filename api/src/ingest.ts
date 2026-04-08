import type { Context } from "hono";
import OpenAI from "openai";
import sql from "./db.js";
import { summarizeDocument } from "./summarize.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBED_MODEL = "text-embedding-3-small";

function stripHtml(html: string): string {
  // Remove script and style blocks entirely
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  // Collapse whitespace
  return text.replace(/\s+/g, " ").trim();
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}

async function sha256(text: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex");
}

export async function handleIngest(c: Context) {
  let body: {
    url: string;
    title?: string;
    doi?: string;
    capturedAt?: string;
    html: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { url, title, doi, capturedAt, html } = body;
  if (!url || !html) {
    return c.json({ ok: false, error: "url and html are required" }, 400);
  }

  const plainText = stripHtml(html);
  const hash = await sha256(plainText);

  // Find existing document by DOI (preferred) or URL
  const existing = doi
    ? await sql`SELECT id, content_hash FROM documents WHERE doi = ${doi} LIMIT 1`
    : await sql`SELECT id, content_hash FROM documents WHERE url = ${url} LIMIT 1`;

  if (existing.length > 0 && existing[0].content_hash === hash) {
    return c.json({ ok: true, status: "skipped", reason: "content unchanged" });
  }

  const capturedAtTs = capturedAt ? new Date(capturedAt) : new Date();

  let documentId: string;
  if (existing.length > 0) {
    // Update existing
    documentId = existing[0].id;
    await sql`
      UPDATE documents
      SET url = ${url}, title = ${title ?? null}, content_hash = ${hash}, updated_at = now()
      WHERE id = ${documentId}
    `;
    await sql`DELETE FROM chunks WHERE document_id = ${documentId}`;
  } else {
    // Insert new
    const [doc] = await sql`
      INSERT INTO documents (url, doi, title, content_hash, captured_at)
      VALUES (${url}, ${doi ?? null}, ${title ?? null}, ${hash}, ${capturedAtTs})
      RETURNING id
    `;
    documentId = doc.id;
  }

  const textChunks = await summarizeDocument(documentId, plainText);
  if (textChunks.length === 0) {
    return c.json({ ok: true, status: "ingested", chunks: 0 });
  }

  const embeddings = await embedTexts(textChunks);

  const rows = textChunks.map((text, i) => ({
    document_id: documentId,
    ordinal: i,
    text,
    embedding: JSON.stringify(embeddings[i]),
  }));

  for (const row of rows) {
    await sql`
      INSERT INTO chunks (document_id, ordinal, text, embedding)
      VALUES (${row.document_id}, ${row.ordinal}, ${row.text}, ${row.embedding}::vector)
    `;
  }

  return c.json({ ok: true, status: "ingested", chunks: textChunks.length });
}
