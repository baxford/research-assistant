# Sections Feature Spec

## Overview

Add a **Sections** feature that lets users organise research into a hierarchy of named, editable sections (analogous to the headings and body of a research article). Documents can be linked to sections in a many-to-many relationship. A tree explorer in the UI lets users navigate, edit, and reorganise sections; the Chrome extension lets users tag a saved page with one or more sections.

---

## 1. Database

### 1.1 Schema approach — recommendation: `parent_id` + `position`

Two options were considered:

| Approach | Pros | Cons |
|---|---|---|
| **`parent_id` + `position`** (recommended) | Simple, no extra extension, easy moves, works fine for article-scale trees | Subtree queries need a recursive CTE |
| `ltree` | Extremely fast path/subtree queries, terse ancestor predicates | Path strings must be updated for every descendant on a move; adds an extension dependency; overkill for small trees |

For article-scale section trees (tens of nodes, not millions), `parent_id` + `position` is the right call. Subtree fetching via a single recursive CTE is fast and readable.

### 1.2 New tables

```sql
-- Sections hierarchy
CREATE TABLE sections (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   UUID        REFERENCES sections(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  content     TEXT        NOT NULL DEFAULT '',
  position    INTEGER     NOT NULL DEFAULT 0,  -- ordering among siblings; lower = earlier
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sections_parent_idx ON sections(parent_id);

-- Many-to-many: sections ↔ documents
CREATE TABLE section_documents (
  section_id  UUID REFERENCES sections(id)  ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (section_id, document_id)
);

CREATE INDEX section_documents_document_idx ON section_documents(document_id);
```

**Notes:**
- Root sections have `parent_id = NULL`.
- `position` is scoped to siblings (sections sharing the same `parent_id`).
- Deleting a section cascades to all its children (via `ON DELETE CASCADE` on `parent_id`).
- Deleting a document removes its join-table rows but leaves sections intact.

### 1.3 Fetching the full tree

A single recursive CTE returns the entire tree in one query, ordered correctly:

```sql
WITH RECURSIVE tree AS (
  SELECT *, 0 AS depth, ARRAY[position] AS path
  FROM sections WHERE parent_id IS NULL
  UNION ALL
  SELECT s.*, t.depth + 1, t.path || s.position
  FROM sections s JOIN tree t ON s.parent_id = t.id
)
SELECT * FROM tree ORDER BY path;
```

### 1.4 Moving a section

Moving is a single `UPDATE` — change `parent_id` and reassign `position` among the new siblings:

```sql
UPDATE sections SET parent_id = $newParent, position = $newPosition, updated_at = now()
WHERE id = $id;
```

No descendant rows need touching (unlike ltree).

---

## 2. API

All routes live under `/api/sections`. Add them to `api/src/index.ts` and implement in a new `api/src/sections.ts` handler file.

### 2.1 Endpoints

| Method | Path | Body / Params | Description |
|---|---|---|---|
| `GET` | `/api/sections` | — | Return only root sections (no parent_id) |
| `POST` | `/api/sections` | `{name, parent_id?, position?, content?}` | Create a section |
| `GET` | `/api/sections/:id` | Return complete hierarchy for the given section id, including id, name, summary of linked documents |
| `PATCH` | `/api/sections/:id` | `{name?, content?}` | Rename / update content |
| `DELETE` | `/api/sections/:id` | — | Delete section + all descendants |
| `PATCH` | `/api/sections/:id/move` | `{parent_id, position}` | Move to new parent / reorder |
| `GET` | `/api/sections/:id/documents` | — | List documents linked to section, returning complete details including chunks |
| `POST` | `/api/sections/:id/documents` | `{document_id}` | Link a document to a section |
| `DELETE` | `/api/sections/:id/documents/:documentId` | — | Unlink a document from a section |

### 2.2 `GET /api/sections` response shape

```json
[
  {
    "id": "uuid",
    "parent_id": null,
    "name": "Introduction",
    "content": "...",
    "position": 0,
    "depth": 0
  }
]
```

### 2.3 Position management

When inserting or moving, shift sibling `position` values to make a gap rather than storing sparse integers. A helper `reorderSiblings(parent_id)` can renumber from 0 after any mutation. For a personal local tool, this is safe and simple.

---

## 3. Frontend

### 3.1 New route

Add `/sections` (and `/sections/:id` for deep-linking to a specific section) to `web/src/main.tsx`.

### 3.2 Layout

The Sections page uses a two-panel layout:

```
┌──────────────────┬────────────────────────────────────────┐
│  Explorer (tree) │  Document view (scrollable)            │
│  (fixed ~260px)  │                                        │
│                  │  # Name                                │
│  ▾ Introduction  │  [content here, click to edit]         │
│    ▸ Background  │                                        │
│    ▸ Motivation  │  ## Content                            │
│  ▾ Methods       │  [content here, click to edit]         │
│    ▸ Data        │  ...                                   |
|                  |                                        |
|                  |  ## Linked Documents                   │
│  + Add section   │  [Show document name, and summary]     │
└──────────────────┴────────────────────────────────────────┘
```

**Explorer (left panel):**
- Collapsible tree nodes (`▾` / `▸`)
- Click a node to jump to it in the right panel
- Each node has hover actions: **rename** (inline edit), **delete** (with confirm), **add child**
- Root-level "+ Add section" button at the bottom
- Drag-and-drop to reorder or reparent nodes (use the `PATCH /:id/move` endpoint on drop)

**Document view (right panel):**
- Renders all sections in hierarchical order as a continuous document
- Section `name` rendered as heading (`h1` for depth 0, `h2` for depth 1, etc.)
- Section `content` rendered as a plain `<textarea>` (or a `<div contenteditable>`) — click-to-edit inline
- Auto-saves `content` on blur via `PATCH /api/sections/:id`
- A "Linked documents" chip count below each section's content; clicking expands a scrollable list of linked document titles and summaries

### 3.3 State management

No new libraries needed. Use React `useState` + `useEffect` with `fetch` calls — consistent with existing pages. The full tree is fetched once on mount and updated optimistically on mutations.

### 3.4 Drag and drop

Use the HTML5 drag-and-drop API (no library) for reordering in the explorer. On `dragover` + `drop`, call `PATCH /:id/move` with the new `parent_id` and computed `position`. The tree is re-fetched after each move.

---

## 4. Chrome Extension

### 4.1 New behaviour

When saving a page, the user can optionally link it to one or more sections.

**UI addition to popup.html:**
- Below the collection dropdown, add a collapsible "Link to sections" area
- Shows a flat-ish checklist of sections (indented by depth) fetched from `GET /api/sections`
- User checks one or more; on "Save Page", `POST /api/sections/:id/documents` is called for each checked section after the ingest completes

### 4.2 Should the extension be converted to React?

**Current state:** Plain HTML + vanilla JS (~200 lines). The popup is simple: a form with a status label, a collection dropdown, and a button.

**Adding section selection** means fetching and rendering a tree of checkboxes. This can still be done in vanilla JS with `document.createElement` loops, but it will start to feel messy once tree indentation, expand/collapse, and multi-select are in play.

**Recommendation: convert the extension to React with a Vite build.**

Reasons:
- The section selector is genuinely tree-shaped UI — the kind of thing React handles cleanly
- Vite + React adds only `npm run build` to the workflow; the output is a static bundle that Chrome loads identically
- It does **not** require sharing React components from the web project (the extension has a very different visual context — 320px popup vs full-page app), but the **API client functions** (fetch wrappers for sections, ingest, lookup) could be shared
- Keeping it vanilla would mean hand-rolling component lifecycle, state, and DOM diffing — at that point you're reinventing React

**What the conversion entails:**
1. Add `extension/package.json` with `vite`, `react`, `react-dom`
2. Add `extension/vite.config.ts` with `rollupOptions.input` pointing at the popup HTML
3. Move `popup.js` → `popup.tsx` as a React component tree
4. Output goes to `extension/dist/`; update `manifest.json` to point there
5. Keep `content.js` as-is (content scripts don't need React)

### 4.3 Component sharing — is turborepo needed?

**Short answer: No.** The only realistic sharing target is API client code (typed `fetch` wrappers), not UI components. Two options:

**Option A — copy fetch helpers (recommended for now):**
Duplicate the small API client functions (`getSection`, `postIngest`, etc.) into the extension. For a personal local tool with one developer, this is pragmatic and avoids build tooling complexity.

**Option B — shared `packages/api-client` package:**
Extract typed API client functions into `packages/api-client/` and consume them in both `web/` and `extension/`. This requires:
- A root `package.json` with `workspaces: ["web", "api", "extension", "packages/*"]`
- Each workspace referencing `"@researcher/api-client": "*"` 
- Turborepo (`turbo.json`) for task caching and coordinated builds

**Turborepo verdict: not yet warranted.** This is a local personal tool with no CI, no team, and three small packages. The build graph is trivial. Adding turborepo solves a coordination problem that doesn't exist here. Revisit if the project grows to 5+ packages or gains a build pipeline that needs caching.

If Option B is desired without turborepo, a plain npm workspaces setup in the root `package.json` is sufficient.

---

## 5. Implementation Order

1. **Database** — add `sections` and `section_documents` tables to `db/init.sql`; add a migration path via the existing `GET /api/migrate` endpoint
2. **API** — implement `api/src/sections.ts` and register routes in `index.ts`
3. **Frontend** — add the `/sections` route and two-panel page to the web app
4. **Extension** — convert to React + Vite, add section selector to popup

Each step is independently testable and can be shipped incrementally.

---

## 6. Out of Scope (deferred)

- Rich text editing (markdown or WYSIWYG) — plain textarea for now
- AI-assisted content generation for sections
- Full-text or semantic search within section content
- Section export (to PDF, markdown, etc.)
- Undo/redo for section edits
