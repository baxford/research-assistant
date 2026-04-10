import { useState, useEffect, useRef } from "react";
import Layout from "../components/Layout";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

interface Section {
  id: string;
  parent_id: string | null;
  name: string;
  content: string;
  position: number;
  depth: number;
  created_at: string;
  updated_at: string;
}

interface LinkedDoc {
  id: string;
  title: string | null;
  url: string;
  summary: string | null;
  linked_at: string;
}

const actionBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  padding: "1px 5px", fontSize: "0.7rem", color: "#888", borderRadius: 3, lineHeight: 1.5,
};

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

export default function SectionsPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [localContent, setLocalContent] = useState<Record<string, string>>({});
  const [expandedDocSummaries, setExpandedDocSummaries] = useState<Set<string>>(new Set());
  const [linkedDocs, setLinkedDocs] = useState<Record<string, LinkedDoc[]>>({});
  const loadedDocSections = useRef<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; zone: "before" | "into" | "after" } | null>(null);
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  async function loadSections() {
    try {
      const res = await fetch(`${API}/api/sections`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSections(data.sections ?? []);
    } catch {
      setError("Failed to load sections.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSections(); }, []);

  useEffect(() => {
    sections.forEach((s) => {
      if (loadedDocSections.current.has(s.id)) return;
      loadedDocSections.current.add(s.id);
      fetch(`${API}/api/sections/${s.id}/documents`)
        .then((r) => r.json())
        .then((data) => setLinkedDocs((prev) => ({ ...prev, [s.id]: data.documents ?? [] })))
        .catch(() => {});
    });
  }, [sections]);

  function childrenOf(parentId: string | null): Section[] {
    return sections
      .filter((s) => s.parent_id === parentId)
      .sort((a, b) => a.position - b.position);
  }

  async function handleCreate(parentId: string | null) {
    const name = parentId === null ? "New project" : "New section";
    try {
      const res = await fetch(`${API}/api/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parent_id: parentId }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      await loadSections();
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
      setRenamingId(data.section.id);
      setRenameValue(name);
    } catch {
      setError("Failed to create section.");
    }
  }

  function startRename(section: Section) {
    setRenamingId(section.id);
    setRenameValue(section.name);
  }

  async function finishRename() {
    if (!renamingId) return;
    const id = renamingId;
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;
    const current = sections.find((s) => s.id === id);
    if (!current || name === current.name) return;
    try {
      await fetch(`${API}/api/sections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setSections((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
    } catch {
      setError("Failed to rename section.");
    }
  }

  async function handleDelete(id: string) {
    const section = sections.find((s) => s.id === id);
    const hasChildren = sections.some((s) => s.parent_id === id);
    const msg = hasChildren
      ? `Delete "${section?.name}" and all its subsections?`
      : `Delete "${section?.name}"?`;
    if (!window.confirm(msg)) return;
    try {
      const res = await fetch(`${API}/api/sections/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setSections((prev) => {
        const toRemove = new Set<string>();
        const queue = [id];
        while (queue.length) {
          const cur = queue.shift()!;
          toRemove.add(cur);
          prev.filter((s) => s.parent_id === cur).forEach((s) => queue.push(s.id));
        }
        return prev.filter((s) => !toRemove.has(s.id));
      });
    } catch {
      setError("Failed to delete section.");
    }
  }

  async function saveContent(id: string, content: string) {
    try {
      await fetch(`${API}/api/sections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      setSections((prev) => prev.map((s) => (s.id === id ? { ...s, content } : s)));
      setLocalContent((prev) => { const n = { ...prev }; delete n[id]; return n; });
    } catch {
      setError("Failed to save content.");
    }
  }

  async function handleDrop(draggedId: string, targetId: string, zone: "before" | "into" | "after") {
    if (draggedId === targetId) return;
    setDragId(null);
    setDropTarget(null);

    const target = sections.find((s) => s.id === targetId)!;
    let newParentId: string | null;
    let newPosition: number;

    if (zone === "into") {
      newParentId = targetId;
      newPosition = sections.filter((s) => s.parent_id === targetId).length;
      setExpanded((prev) => new Set(prev).add(targetId));
    } else {
      newParentId = target.parent_id;
      const siblings = sections
        .filter((s) => s.parent_id === newParentId && s.id !== draggedId)
        .sort((a, b) => a.position - b.position);
      const ti = siblings.findIndex((s) => s.id === targetId);
      newPosition = zone === "before" ? Math.max(0, ti) : ti + 1;
    }

    try {
      const res = await fetch(`${API}/api/sections/${draggedId}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_id: newParentId, position: newPosition }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Failed to move section.");
        return;
      }
      await loadSections();
    } catch {
      setError("Failed to move section.");
    }
  }

  // ── Explorer tree node ──────────────────────────────────────────────────────

  function renderNode(section: Section, depth: number): React.ReactNode {
    const children = childrenOf(section.id);
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(section.id);
    const isHovered = hoveredId === section.id;
    const isRenaming = renamingId === section.id;
    const isDragging = dragId === section.id;
    const dt = dropTarget?.id === section.id ? dropTarget.zone : null;
    const indent = depth * 16;

    return (
      <div key={section.id} style={{ opacity: isDragging ? 0.4 : 1 }}>
        {dt === "before" && (
          <div style={{ height: 2, background: "#1a73e8", borderRadius: 1, margin: `2px ${indent + 20}px` }} />
        )}
        <div
          draggable
          onDragStart={(e) => { e.stopPropagation(); setDragId(section.id); e.dataTransfer.effectAllowed = "move"; }}
          onDragEnd={() => { setDragId(null); setDropTarget(null); }}
          onDragOver={(e) => {
            e.preventDefault(); e.stopPropagation();
            if (!dragId || dragId === section.id) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const zone: "before" | "into" | "after" = y < rect.height * 0.3 ? "before" : y > rect.height * 0.7 ? "after" : "into";
            setDropTarget((prev) => (prev?.id === section.id && prev.zone === zone ? prev : { id: section.id, zone }));
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDropTarget((prev) => (prev?.id === section.id ? null : prev));
            }
          }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragId) handleDrop(dragId, section.id, dt ?? "after"); }}
          onMouseEnter={() => setHoveredId(section.id)}
          onMouseLeave={() => setHoveredId((prev) => (prev === section.id ? null : prev))}
          style={{
            display: "flex", alignItems: "center",
            padding: `3px 6px 3px ${indent + 4}px`,
            borderRadius: 4, minHeight: 28, cursor: "grab",
            background: dt === "into" ? "#e8f0fe" : (isHovered && !isDragging ? "#f0f0f0" : undefined),
            outline: dt === "into" ? "1px solid #1a73e8" : undefined,
          }}
        >
          {/* Collapse toggle */}
          <span
            onClick={(e) => { e.stopPropagation(); setExpanded((prev) => { const n = new Set(prev); n.has(section.id) ? n.delete(section.id) : n.add(section.id); return n; }); }}
            style={{
              width: 16, flexShrink: 0, fontSize: "0.65rem", color: "#aaa",
              cursor: hasChildren ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center",
              visibility: hasChildren ? "visible" : "hidden",
            }}
          >
            {isExpanded ? "▾" : "▸"}
          </span>

          {/* Name / rename input */}
          {isRenaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={finishRename}
              onKeyDown={(e) => { if (e.key === "Enter") finishRename(); if (e.key === "Escape") setRenamingId(null); }}
              onClick={(e) => e.stopPropagation()}
              style={{ flex: 1, border: "1px solid #1a73e8", borderRadius: 3, padding: "1px 4px", fontSize: "0.85rem", outline: "none", minWidth: 0 }}
            />
          ) : (
            <span
              onClick={() => document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              onDoubleClick={() => startRename(section)}
              title={section.name}
              style={{ flex: 1, fontSize: "0.85rem", color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer", minWidth: 0 }}
            >
              {section.name}
            </span>
          )}

          {/* Hover actions */}
          {(isHovered || isRenaming) && (
            <div style={{ display: "flex", gap: 1, flexShrink: 0 }}>
              <button title="Add child" onClick={(e) => { e.stopPropagation(); handleCreate(section.id); }} style={actionBtn}>+</button>
              <button title="Rename" onClick={(e) => { e.stopPropagation(); startRename(section); }} style={actionBtn}>✎</button>
              <button title="Delete" onClick={(e) => { e.stopPropagation(); handleDelete(section.id); }} style={{ ...actionBtn, color: "#c00" }}>✕</button>
            </div>
          )}
        </div>
        {dt === "after" && (
          <div style={{ height: 2, background: "#1a73e8", borderRadius: 1, margin: `2px ${indent + 20}px` }} />
        )}
        {isExpanded && children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  // ── Document view section ───────────────────────────────────────────────────

  function renderDocSection(section: Section): React.ReactNode {
    const tagLevel = Math.min(section.depth + 1, 6) as 1 | 2 | 3 | 4 | 5 | 6;
    const Tag = `h${tagLevel}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    const content = section.id in localContent ? localContent[section.id] : section.content;
    const docs = linkedDocs[section.id];

    return (
      <div key={section.id} id={`section-${section.id}`} style={{ marginBottom: "2rem" }}>
        <Tag style={{ margin: "0 0 0.5rem", fontWeight: 600, color: "#111" }}>{section.name}</Tag>
        <textarea
          ref={(el) => {
            if (el) { textareaRefs.current.set(section.id, el); autoResize(el); }
            else textareaRefs.current.delete(section.id);
          }}
          value={content}
          placeholder="Add notes…"
          onChange={(e) => { setLocalContent((prev) => ({ ...prev, [section.id]: e.target.value })); autoResize(e.target); }}
          onBlur={(e) => { if (content !== section.content) saveContent(section.id, e.target.value); }}
          rows={1}
          style={{
            width: "100%", boxSizing: "border-box", display: "block",
            border: "1px solid #e0e0e0", borderRadius: 4,
            padding: "0.5rem 0.75rem", fontSize: "0.9rem",
            lineHeight: 1.7, resize: "none", overflow: "hidden",
            fontFamily: "inherit", color: "#333", minHeight: 60,
          }}
        />
        {docs && docs.length > 0 && (
          <div style={{ marginTop: "0.5rem", paddingLeft: "1rem", borderLeft: "2px solid #eee" }}>
            {docs.map((doc) => {
              const key = `${section.id}:${doc.id}`;
              const summaryOpen = expandedDocSummaries.has(key);
              return (
                <div key={doc.id} style={{ marginBottom: "0.4rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                    {doc.summary && (
                      <button
                        onClick={() => setExpandedDocSummaries((prev) => {
                          const n = new Set(prev);
                          summaryOpen ? n.delete(key) : n.add(key);
                          return n;
                        })}
                        style={{ background: "none", border: "none", padding: 0, fontSize: "0.65rem", color: "#aaa", cursor: "pointer", flexShrink: 0, lineHeight: 1 }}
                      >
                        {summaryOpen ? "▾" : "▸"}
                      </button>
                    )}
                    <a href={doc.url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: "0.85rem", fontWeight: 500, color: "#1a73e8" }}>
                      {doc.title || doc.url}
                    </a>
                  </div>
                  {summaryOpen && doc.summary && (
                    <p style={{ margin: "3px 0 0 1rem", fontSize: "0.8rem", color: "#666", lineHeight: 1.4, whiteSpace: "pre-line" }}>
                      {doc.summary}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const roots = childrenOf(null);

  return (
    <Layout>
      <div style={{ display: "flex", background: "#fff", minHeight: "calc(100vh - 4rem)" }}>

        {/* ── Explorer panel ── */}
        <div style={{ width: 260, flexShrink: 0, borderRight: "1px solid #e0e0e0", display: "flex", flexDirection: "column", background: "#fafafa" }}>

          {/* Header */}
          <div style={{ padding: "0.65rem 1rem", borderBottom: "1px solid #e0e0e0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
            <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "#333" }}>Project Tree</span>
            <button
              onClick={() => handleCreate(null)}
              style={{ padding: "2px 8px", fontSize: "0.75rem", background: "none", border: "1px dashed #ccc", borderRadius: 3, cursor: "pointer", color: "#888" }}
            >
              + Add
            </button>
          </div>

        {/* Tree */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0.4rem 0" }}>
          {loading && <p style={{ padding: "0.5rem 1rem", fontSize: "0.8rem", color: "#aaa", margin: 0 }}>Loading…</p>}
          {!loading && roots.length === 0 && (
            <p style={{ padding: "0.5rem 1rem", fontSize: "0.8rem", color: "#aaa", margin: 0 }}>No projects yet.</p>
          )}
          {roots.map((s) => renderNode(s, 0))}
        </div>
      </div>

      {/* ── Document view panel ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "2rem 2.5rem" }}>
        {error && (
          <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", padding: "0.6rem 1rem", borderRadius: 4, marginBottom: "1.5rem", fontSize: "0.85rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#666", padding: 0 }}>✕</button>
          </div>
        )}
        {!loading && sections.length === 0 && (
          <div style={{ color: "#bbb", textAlign: "center", marginTop: "6rem" }}>
            <p style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No projects yet.</p>
            <p style={{ fontSize: "0.85rem", margin: 0 }}>Use the panel on the left to add your first project.</p>
          </div>
        )}
        {sections.map(renderDocSection)}
      </div>
      </div>
    </Layout>
  );
}
