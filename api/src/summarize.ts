import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import sql from "./db.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SummaryAndChunks = z.object({
  summary: z
    .string()
    .describe("3-5 concise bullet points starting with '•' summarising the main points"),
  chunks: z
    .string().array()
    .describe(
      "Cleaned text strings each representing a logically distinct section, suitable for semantic search"
    ),
});

type SummaryAndChunks = z.infer<typeof SummaryAndChunks>;

export async function generateSummaryAndChunks(
  text: string
): Promise<SummaryAndChunks> {
  const res = await openai.beta.chat.completions.parse({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a research assistant processing web page content for a searchable knowledge base.
Generate a summary of the entire document, which outlines the key topics and important concepts.
Also generate a list of chunks based on the sections of the document, each representing a logically distinct section, suitable for semantic search.

Rules for chunks:
- Split based on natural document sections (e.g. introduction, background, methods, results, conclusions, key concepts)
- Clean each chunk: remove citation markers such as [1] or (Author, 2020), remove raw URLs and hyperlink text, remove isolated figure/table captions
- Exclude entirely: reference lists, bibliographies, acknowledgments, author bios, copyright notices, navigation menus, site headers and footers
- Each chunk should be self-contained and meaningful for semantic search (aim for 100–400 words per chunk)
- Preserve technical terms, key concepts, and domain-specific language`,
      },
      { role: "user", content: text.slice(0, 30000) },
    ],
    max_tokens: 2000,
    response_format: zodResponseFormat(SummaryAndChunks, "summary_and_chunks"),
  });

  const parsed = res.choices[0].message.parsed;
  if (!parsed) {
    return { summary: "", chunks: [] };
  }
  console.log(parsed);
  return {
    summary: parsed.summary,
    chunks: parsed.chunks.filter((c) => c.length > 20),
  };
}

export async function summarizeDocument(
  documentId: string,
  text: string
): Promise<string[]> {
  try {
    const { summary, chunks } = await generateSummaryAndChunks(text);
    await sql`UPDATE documents SET summary = ${summary} WHERE id = ${documentId}`;
    return chunks;
  } catch (err) {
    console.error(`Failed to summarize document ${documentId}:`, err);
    return [];
  }
}
