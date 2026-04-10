import type { Context } from "hono";
import sql from "./db.js";

async function reorderSiblings(parentId: string | null) {
  await sql`
    UPDATE sections SET position = sub.new_pos, updated_at = now()
    FROM (
      SELECT id, (ROW_NUMBER() OVER (ORDER BY position, created_at) - 1)::int AS new_pos
      FROM sections WHERE parent_id IS NOT DISTINCT FROM ${parentId}
    ) sub
    WHERE sections.id = sub.id
  `;
}

export async function handleGetSections(c: Context) {
  const rows = await sql`
    WITH RECURSIVE tree AS (
      SELECT id, parent_id, name, content, position, created_at, updated_at,
             0 AS depth, ARRAY[position]::int[] AS sort_path
      FROM sections WHERE parent_id IS NULL
      UNION ALL
      SELECT s.id, s.parent_id, s.name, s.content, s.position, s.created_at, s.updated_at,
             t.depth + 1, t.sort_path || s.position
      FROM sections s JOIN tree t ON s.parent_id = t.id
    )
    SELECT id, parent_id, name, content, position, depth, created_at, updated_at
    FROM tree ORDER BY sort_path
  `;
  return c.json({ sections: rows });
}

export async function handleCreateSection(c: Context) {
  let body: { name: string; parent_id?: string | null; position?: number; content?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const name = body.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);

  const parentId = body.parent_id ?? null;
  const content = body.content ?? "";

  let position: number;
  if (body.position !== undefined) {
    position = body.position;
  } else {
    const [{ max }] = await sql<[{ max: number | null }]>`
      SELECT MAX(position) AS max FROM sections
      WHERE parent_id IS NOT DISTINCT FROM ${parentId}
    `;
    position = (max ?? -1) + 1;
  }

  const [section] = await sql`
    INSERT INTO sections (parent_id, name, content, position)
    VALUES (${parentId}, ${name}, ${content}, ${position})
    RETURNING id, parent_id, name, content, position, created_at, updated_at
  `;
  return c.json({ section }, 201);
}

export async function handleGetSection(c: Context) {
  const { id } = c.req.param();

  const nodes = await sql`
    WITH RECURSIVE tree AS (
      SELECT id, parent_id, name, content, position, created_at, updated_at, 0 AS depth,
             ARRAY[0]::int[] AS sort_path
      FROM sections WHERE id = ${id}
      UNION ALL
      SELECT s.id, s.parent_id, s.name, s.content, s.position, s.created_at, s.updated_at,
             t.depth + 1, t.sort_path || s.position
      FROM sections s JOIN tree t ON s.parent_id = t.id
    )
    SELECT id, parent_id, name, content, position, depth, created_at, updated_at
    FROM tree ORDER BY sort_path
  `;

  if (nodes.length === 0) return c.json({ error: "Not found" }, 404);

  const nodeIds = nodes.map((n: any) => n.id);
  const links = await sql`
    SELECT sd.section_id, d.id, d.title, d.url, d.summary, sd.created_at AS linked_at
    FROM section_documents sd
    JOIN documents d ON d.id = sd.document_id
    WHERE sd.section_id = ANY(${sql.array(nodeIds)}::uuid[])
    ORDER BY sd.created_at
  `;

  const docsBySectionId = new Map<string, any[]>();
  for (const link of links) {
    const arr = docsBySectionId.get(link.section_id) ?? [];
    arr.push({ id: link.id, title: link.title, url: link.url, summary: link.summary, linked_at: link.linked_at });
    docsBySectionId.set(link.section_id, arr);
  }

  const map = new Map<string, any>();
  for (const node of nodes) {
    map.set(node.id, { ...node, documents: docsBySectionId.get(node.id) ?? [], children: [] });
  }
  let root: any = null;
  for (const node of nodes) {
    const item = map.get(node.id)!;
    if (node.id === id) {
      root = item;
    } else if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id).children.push(item);
    }
  }

  return c.json({ section: root });
}

export async function handleUpdateSection(c: Context) {
  const { id } = c.req.param();
  let body: { name?: string; content?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const name = body.name !== undefined ? body.name.trim() : undefined;
  const content = body.content !== undefined ? body.content : undefined;

  if (name === undefined && content === undefined) {
    return c.json({ error: "name or content required" }, 400);
  }
  if (name !== undefined && name === "") {
    return c.json({ error: "name cannot be empty" }, 400);
  }

  const result = await sql`
    UPDATE sections SET
      name    = COALESCE(${name    ?? null}, name),
      content = COALESCE(${content ?? null}, content),
      updated_at = now()
    WHERE id = ${id}
    RETURNING id, parent_id, name, content, position, created_at, updated_at
  `;
  if (result.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ section: result[0] });
}

export async function handleDeleteSection(c: Context) {
  const { id } = c.req.param();
  const result = await sql`DELETE FROM sections WHERE id = ${id} RETURNING id`;
  if (result.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
}

export async function handleMoveSection(c: Context) {
  const { id } = c.req.param();
  let body: { parent_id: string | null; position: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  if (body.position === undefined) return c.json({ error: "position is required" }, 400);

  const newParentId = body.parent_id ?? null;

  if (newParentId !== null) {
    const hit = await sql`
      WITH RECURSIVE tree AS (
        SELECT id FROM sections WHERE id = ${id}
        UNION ALL
        SELECT s.id FROM sections s JOIN tree t ON s.parent_id = t.id
      )
      SELECT id FROM tree WHERE id = ${newParentId}
    `;
    if (hit.length > 0) {
      return c.json({ error: "Cannot move a section into one of its own descendants" }, 400);
    }
  }

  const [existing] = await sql`SELECT parent_id FROM sections WHERE id = ${id}`;
  if (!existing) return c.json({ error: "Not found" }, 404);
  const oldParentId: string | null = existing.parent_id ?? null;

  // Get all current siblings in the new parent group (excluding the moved item), in order
  const newParentSiblings = await sql`
    SELECT id FROM sections
    WHERE parent_id IS NOT DISTINCT FROM ${newParentId} AND id != ${id}
    ORDER BY position, created_at
  `;

  // Insert the moved item at the requested index to produce the desired final order
  const siblingIds: string[] = newParentSiblings.map((s: any) => s.id);
  const insertAt = Math.max(0, Math.min(body.position, siblingIds.length));
  siblingIds.splice(insertAt, 0, id);

  // Assign sequential positions to every item in the new parent group
  for (let i = 0; i < siblingIds.length; i++) {
    const sibId = siblingIds[i];
    if (sibId === id) {
      await sql`UPDATE sections SET parent_id = ${newParentId}, position = ${i}, updated_at = now() WHERE id = ${id}`;
    } else {
      await sql`UPDATE sections SET position = ${i}, updated_at = now() WHERE id = ${sibId}`;
    }
  }

  // If parent changed, renormalise the old parent group too
  if (newParentId !== oldParentId) {
    await reorderSiblings(oldParentId);
  }

  const [section] = await sql`
    SELECT id, parent_id, name, content, position, created_at, updated_at FROM sections WHERE id = ${id}
  `;
  return c.json({ section });
}

export async function handleGetSectionDocuments(c: Context) {
  const { id } = c.req.param();
  const [section] = await sql`SELECT id FROM sections WHERE id = ${id}`;
  if (!section) return c.json({ error: "Not found" }, 404);

  const documents = await sql`
    SELECT d.id, d.url, d.doi, d.title, d.summary, d.authors, d.published_at, d.captured_at,
           d.collection_id, sd.created_at AS linked_at
    FROM section_documents sd
    JOIN documents d ON d.id = sd.document_id
    WHERE sd.section_id = ${id}
    ORDER BY sd.created_at
  `;
  return c.json({ documents });
}

export async function handleLinkDocument(c: Context) {
  const { id } = c.req.param();
  let body: { document_id: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  if (!body.document_id) return c.json({ error: "document_id is required" }, 400);

  await sql`
    INSERT INTO section_documents (section_id, document_id)
    VALUES (${id}, ${body.document_id})
    ON CONFLICT DO NOTHING
  `;
  return c.json({ ok: true }, 201);
}

export async function handleUnlinkDocument(c: Context) {
  const { id, documentId } = c.req.param();
  const result = await sql`
    DELETE FROM section_documents
    WHERE section_id = ${id} AND document_id = ${documentId}
    RETURNING section_id
  `;
  if (result.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
}
