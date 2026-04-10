import { useEffect, useState } from "react";
import Nav from "../components/Nav";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

interface Collection {
  id: string;
  name: string;
}

interface Doc {
  id: string;
  url: string;
  doi: string | null;
  title: string | null;
  summary: string | null;
  captured_at: string;
  updated_at: string;
  authors: string | null;
  published_at: string | null;
  collection_id: string;
}

async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${API}/api/documents/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

export default function SavedPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`${API}/api/collections`)
      .then((r) => r.json())
      .then((d) => setCollections(d.collections))
      .catch(() => {});
  }, []);

  function fetchDocs(filter: Set<string>) {
    setLoading(true);
    setError(null);
    const collectionsParam = filter.size > 0
      ? `?collections=${Array.from(filter).join(",")}`
      : "";
    fetch(`${API}/api/documents${collectionsParam}`)
      .then((r) => r.json())
      .then((d) => setDocs(d.documents))
      .catch(() => setError("Failed to load saved pages."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchDocs(new Set());
  }, []);

  function toggleCollection(id: string) {
    const next = new Set(selectedCollections);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedCollections(next);
    fetchDocs(next);
  }

  async function handleDelete(id: string) {
    setDeleting((prev) => new Set(prev).add(id));
    try {
      await deleteDocument(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch {
      setError("Failed to delete document.");
    } finally {
      setDeleting((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Saved Pages</h1>
        <Nav />
      </div>

      {collections.length > 0 && (
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "1.5rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", color: "#888", marginRight: "0.2rem" }}>Collections:</span>
          {collections.map((col) => {
            const active = selectedCollections.has(col.id);
            return (
              <button
                key={col.id}
                onClick={() => toggleCollection(col.id)}
                style={{
                  padding: "3px 10px", fontSize: "0.8rem", borderRadius: 12,
                  border: `1px solid ${active ? "#1a73e8" : "#ccc"}`,
                  background: active ? "#e8f0fe" : "#fff",
                  color: active ? "#1a73e8" : "#555",
                  cursor: "pointer", fontWeight: active ? 600 : 400,
                }}
              >
                {col.name}
              </button>
            );
          })}
          {selectedCollections.size > 0 && (
            <button
              onClick={() => { setSelectedCollections(new Set()); fetchDocs(new Set()); }}
              style={{ padding: "3px 10px", fontSize: "0.8rem", borderRadius: 12, border: "1px solid #ccc", background: "none", color: "#888", cursor: "pointer" }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
      {!loading && !error && docs.length === 0 && <p style={{ color: "#666" }}>No pages saved yet.</p>}

      {docs.map((doc) => (
        <article key={doc.id} style={{ marginBottom: "0.75rem", padding: "0.75rem 1rem", border: "1px solid #e0e0e0", borderRadius: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
              {doc.title || doc.url}
            </a>
            <div style={{ display: "flex", gap: "0.5rem", marginLeft: "1rem", flexShrink: 0 }}>
              <a
                href={`/document/${doc.id}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ padding: "2px 10px", fontSize: "0.8rem", background: "none", border: "1px solid #ccc", borderRadius: 4, cursor: "pointer", color: "#333", whiteSpace: "nowrap", textDecoration: "none" }}
              >
                View
              </a>
              <button
                onClick={() => handleDelete(doc.id)}
                disabled={deleting.has(doc.id)}
                style={{ padding: "2px 10px", fontSize: "0.8rem", background: "none", border: "1px solid #ccc", borderRadius: 4, cursor: "pointer", color: "#c00", whiteSpace: "nowrap" }}
              >
                {deleting.has(doc.id) ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
          {doc.summary && (
            <div style={{ margin: "0.5rem 0 0.25rem", fontSize: "0.85rem", lineHeight: 1.6, color: "#555", background: "#f8f8f8", borderRadius: 4, padding: "0.5rem 0.75rem", whiteSpace: "pre-line" }}>
              {doc.summary}
            </div>
          )}
          <div style={{ fontSize: "0.75rem", color: "#888", marginTop: "0.25rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {doc.authors && <span>Authors: {doc.authors}</span>}
            {doc.published_at && <span>Published: {new Date(doc.published_at).toLocaleDateString()}</span>}
            {doc.doi && <span>DOI: {doc.doi}</span>}
            {collections.length > 1 && (
              <span>{collections.find((c) => c.id === doc.collection_id)?.name ?? ""}</span>
            )}
            <span style={{ wordBreak: "break-all" }}>{doc.url}</span>
            <span>Saved: {new Date(doc.captured_at).toLocaleDateString()}</span>
          </div>
        </article>
      ))}
    </>
  );
}
