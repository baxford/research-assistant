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
    .string().array().min(2)
    .describe(
      "Verbatim or near-verbatim extracted passages from the original text. Do NOT paraphrase, summarize, or rewrite. Copy the actual sentences and paragraphs from the source."
    ),
  reasoning: z
    .string().array()
    .describe("A brief explanation of the reasoning process used to generate the summary and chunks"),
  published_at: z
    .string()
    .describe("The publication date of the article in ISO 8601 format (YYYY-MM-DD or YYYY-MM or YYYY). Look for dates in meta tags, bylines, article headers, or other date indicators. Leave undefined if no publication date can be found."),
  authors: z
    .string()
    .describe("A comma-separated list of the article's authors as they appear in the document (e.g. 'Jane Smith, John Doe'). Look in bylines, author meta tags (citation_author, DC.creator, author), or article headers. Leave empty string if no authors can be found."),
});

type SummaryAndChunks = z.infer<typeof SummaryAndChunks>;

export async function generateSummaryAndChunks(
  text: string
): Promise<SummaryAndChunks> {
  console.log({SUMMARIZING: text.length});
  const res = await openai.beta.chat.completions.parse({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a research assistant processing web page content for a searchable knowledge base.
You have Three main tasks: chunking, summarization and reasoning.

Task 1: Chunking
- Generate a list of chunks based on the sections of the document, each representing a comprehensive and logically distinct section, suitable for semantic search.
- CRITICAL:This is not a summarization task, it is a chunking task, so do not summarize the initial content or the content of the chunks, just chunk the content into logically distinct sections.

Rules for chunks:
- Include the main article content only, and exclude other sections of the document.
- Exclude entirely: reference lists, bibliographies, acknowledgments, footnotes, author bios, copyright notices, navigation menus, site headers and footers
- If an <article> tag is present, include the content of the <article> tag only, and exclude other content of the document.
- Use headings (e.g. introduction, background, methods, results, conclusions, key concepts) and other semantic information to assist with chunking. 
- HTML <section>, <h1>, <h2>, <h3>, <h4> type tags are a good guide for the start of chunks, but do NOT include the heading text alone as a chunk.
- CRITICAL: Every chunk must contain substantive prose or data — never output a chunk that is only a heading, title, or a few words. A chunk must convey actual information a reader could learn from.
- If a section's body text is too short to stand alone, merge it with the adjacent section rather than emitting a stub chunk.
- Minimum chunk length is 50 words of real content (not counting headings or labels). Discard anything shorter.
- Remove HTML tags 
- CRITICAL: Copy text verbatim or near-verbatim from the source. Do NOT paraphrase, reword, or abstract. A reader must see the actual sentences from the original document, not your restatement of them.
- Clean each chunk: remove citation markers such as [1] or (Author, 2020), remove raw URLs and hyperlink text, remove isolated figure/table captions
- Each chunk should be self-contained and meaningful for semantic search (aim for around 500 words per chunk).
- Large sections greater than 1000 words can be split into multiple chunks if needed.
- Preserve technical terms, key concepts, and domain-specific language

Task 2: Summarization
- Generate a summary of the entire document, which outlines the key topics and important concepts. Remove HTML tags but preserve formatting.

Task 3: Reasoning
- Generate a brief explanation of the reasoning process used to generate the summary and chunks.

Rules for reasoning:
 - The first array element should be a very brief explanation of the reasoning process used to generate the summary.
 - For each chunk, return a name for the chunk and a very brief explanation of the reasoning used to generate the chunk.

Task 4: Publication Date
- Determine the publication date of the article if available.
- Look in meta tags (e.g. article:published_time, datePublished, DC.date, citation_publication_date), bylines, article headers, or any visible date near the title.
- Return the date in ISO 8601 format: YYYY-MM-DD if the full date is known, YYYY-MM if only month/year, or YYYY if only the year.
- If no publication date can be found, omit the field entirely.

Task 5: Authors
- Extract the authors of the article if available.
- Look in bylines, author meta tags (citation_author, DC.creator, article:author), or article headers.
- Return a comma-separated string of author names as they appear in the document (e.g. "Jane Smith, John Doe").
- If no authors can be found, return an empty string.
`,
      },
      { role: "user", content: text },
    ],
    response_format: zodResponseFormat(SummaryAndChunks, "summary_and_chunks"),
  });

  const parsed = res.choices[0].message.parsed;
  const usage = res.usage;
  console.log({usage});
  if (!parsed) {
    return { summary: "", chunks: [], reasoning: [], published_at: "", authors: "" };
  }
  console.log(parsed.reasoning);
  console.log(parsed.chunks);
  return parsed
}

export async function summarizeDocument(
  documentId: string,
  text: string
): Promise<string[]> {
  try {
    const { summary, chunks, published_at, authors } = await generateSummaryAndChunks(text);
    console.log({SUMMARY: summary.length, CHUNKS: chunks.length, published_at, authors});
    const publishedAt = published_at ? new Date(published_at) : null;
    await sql`
      UPDATE documents
      SET summary = ${summary}, published_at = ${publishedAt}, authors = ${authors || null}
      WHERE id = ${documentId}
    `;
    return chunks;
  } catch (err) {
    console.error(`Failed to summarize document ${documentId}:`, err);
    return [];
  }
}
