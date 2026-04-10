import type { Context } from "hono";
import OpenAI from "openai";
import sql from "./db.js";
import { summarizeDocument } from "./summarize.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBED_MODEL = "text-embedding-3-small";

function stripHtml(html: string): string {
  // Remove script and style blocks entirely
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Remove reference/bibliography sections by id
  text = text.replace(/<section[^>]+id=["'][^"']*(?:bib|references)[^"']*["'][^>]*>[\s\S]*?<\/section>/gi, " ");
  // Remove all tags except semantic structure tags
  text = text.replace(/<(?!\/?(article|section|h[1-4])[\s>])[^>]*>/gi, " ");
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

async function resolveCollectionId(collectionId?: string): Promise<string> {
  if (collectionId) return collectionId;
  const [col] = await sql`SELECT id FROM collections WHERE name = 'Default' LIMIT 1`;
  if (!col) throw new Error("Default collection not found");
  return col.id;
}

async function linkSections(documentId: string, sectionIds: string[]) {
  for (const sectionId of sectionIds) {
    await sql`
      INSERT INTO section_documents (section_id, document_id)
      VALUES (${sectionId}, ${documentId})
      ON CONFLICT DO NOTHING
    `;
  }
}

export async function handleIngest(c: Context) {
  let body: {
    url: string;
    title?: string;
    doi?: string;
    capturedAt?: string;
    html: string;
    force?: boolean;
    collection_id?: string;
    section_ids?: string[];
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { url, title, doi, capturedAt, html, force, collection_id, section_ids } = body;
  if (!url || !html) {
    return c.json({ ok: false, error: "url and html are required" }, 400);
  }

  const plainText = stripHtml(html);
  const hash = await sha256(plainText);

  console.log({ INDEXING: url, doi, length: plainText.length });

  // Find existing document by DOI (preferred) or URL
  const existing = doi
    ? await sql`SELECT id, content_hash FROM documents WHERE doi = ${doi} LIMIT 1`
    : await sql`SELECT id, content_hash FROM documents WHERE url = ${url} LIMIT 1`;

  const isSkipped = !force && existing.length > 0 && existing[0].content_hash === hash;

  let documentId: string;
  let chunks = 0;

  if (isSkipped) {
    documentId = existing[0].id;
    console.log({ SKIPPING: url, doi, reason: "content unchanged" });
  } else {
    const capturedAtTs = capturedAt ? new Date(capturedAt) : new Date();
    const resolvedCollectionId = await resolveCollectionId(collection_id);

    if (existing.length > 0) {
      documentId = existing[0].id;
      await sql`
        UPDATE documents
        SET url = ${url}, title = ${title ?? null}, content_hash = ${hash},
            collection_id = ${resolvedCollectionId}, updated_at = now()
        WHERE id = ${documentId}
      `;
      await sql`DELETE FROM chunks WHERE document_id = ${documentId}`;
    } else {
      const [doc] = await sql`
        INSERT INTO documents (url, doi, title, content_hash, captured_at, collection_id)
        VALUES (${url}, ${doi ?? null}, ${title ?? null}, ${hash}, ${capturedAtTs}, ${resolvedCollectionId})
        RETURNING id
      `;
      documentId = doc.id;
    }

    const textChunks = await summarizeDocument(documentId, plainText);

    if (textChunks.length > 0) {
      console.log({ GENERATING_EMBEDDINGS: url, doi, chunks: textChunks.length });
      const embeddings = await embedTexts(textChunks);
      for (let i = 0; i < textChunks.length; i++) {
        await sql`
          INSERT INTO chunks (document_id, ordinal, text, embedding)
          VALUES (${documentId}, ${i}, ${textChunks[i]}, ${JSON.stringify(embeddings[i])}::vector)
        `;
      }
      chunks = textChunks.length;
    }
  }

  // Link to sections — always applied, even on skipped (allows adding links without re-indexing)
  if (section_ids && section_ids.length > 0) {
    await linkSections(documentId, section_ids);
  }

  return c.json({
    ok: true,
    status: isSkipped ? "skipped" : "ingested",
    ...(isSkipped ? { reason: "content unchanged" } : { chunks }),
    documentId,
  });
}
