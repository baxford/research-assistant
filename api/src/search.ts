import type { Context } from "hono";
import OpenAI from "openai";
import sql from "./db.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBED_MODEL = "text-embedding-3-small";
const TOP_K = 20;

interface SearchHit {
  chunkId: string;
  text: string;
  documentId: string;
  documentUrl: string;
  documentTitle: string | null;
  summary: string | null;
  doi: string | null;
  collectionId: string;
  savedAt: string;
  score: number;
  matchType: "vector" | "fts" | "both";
}

function rrfScore(rank: number, k = 60): number {
  return 1 / (k + rank);
}

export async function handleSearch(c: Context) {
  const q = c.req.query("q")?.trim();
  if (!q) {
    return c.json({ results: [] });
  }

  const collectionsParam = c.req.query("collections");
  const collectionIds = collectionsParam ? collectionsParam.split(",").filter(Boolean) : [];
  const hasCollectionFilter = collectionIds.length > 0;

  // Embed the query
  const embRes = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: [q],
  });
  const queryVec = JSON.stringify(embRes.data[0].embedding);

  type Row = { id: string; text: string; doc_id: string; url: string; title: string | null; summary: string | null; doi: string | null; collection_id: string; captured_at: Date };

  // Vector search
  const vectorRows = hasCollectionFilter
    ? await sql<Row[]>`
        SELECT c.id, c.text, d.id AS doc_id, d.url, d.title, d.summary, d.doi, d.collection_id, d.captured_at
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE d.collection_id = ANY(${sql.array(collectionIds)}::uuid[])
        ORDER BY c.embedding <=> ${queryVec}::vector
        LIMIT ${TOP_K}
      `
    : await sql<Row[]>`
        SELECT c.id, c.text, d.id AS doc_id, d.url, d.title, d.summary, d.doi, d.collection_id, d.captured_at
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        ORDER BY c.embedding <=> ${queryVec}::vector
        LIMIT ${TOP_K}
      `;

  // FTS search
  const ftsRows = hasCollectionFilter
    ? await sql<Row[]>`
        SELECT c.id, c.text, d.id AS doc_id, d.url, d.title, d.summary, d.doi, d.collection_id, d.captured_at
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE c.tsv @@ websearch_to_tsquery('english', ${q})
          AND d.collection_id = ANY(${sql.array(collectionIds)}::uuid[])
        ORDER BY ts_rank(c.tsv, websearch_to_tsquery('english', ${q})) DESC
        LIMIT ${TOP_K}
      `
    : await sql<Row[]>`
        SELECT c.id, c.text, d.id AS doc_id, d.url, d.title, d.summary, d.doi, d.collection_id, d.captured_at
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE c.tsv @@ websearch_to_tsquery('english', ${q})
        ORDER BY ts_rank(c.tsv, websearch_to_tsquery('english', ${q})) DESC
        LIMIT ${TOP_K}
      `;

  // Reciprocal Rank Fusion
  const scores = new Map<string, { score: number; row: Row; matchType: "vector" | "fts" | "both" }>();

  vectorRows.forEach((row, i) => {
    scores.set(row.id, { score: rrfScore(i + 1), row, matchType: "vector" });
  });

  ftsRows.forEach((row, i) => {
    const existing = scores.get(row.id);
    if (existing) {
      existing.score += rrfScore(i + 1);
      existing.matchType = "both";
    } else {
      scores.set(row.id, { score: rrfScore(i + 1), row, matchType: "fts" });
    }
  });

  const results: SearchHit[] = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K)
    .map(({ score, row, matchType }) => ({
      chunkId: row.id,
      text: row.text,
      documentId: row.doc_id,
      documentUrl: row.url,
      documentTitle: row.title,
      summary: row.summary,
      doi: row.doi,
      collectionId: row.collection_id,
      savedAt: row.captured_at.toISOString(),
      score: Math.round(score * 10000) / 10000,
      matchType,
    }));

  return c.json({ results });
}
