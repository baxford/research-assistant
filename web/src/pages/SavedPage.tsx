import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

interface Doc {
  id: string;
  url: string;
  doi: string | null;
  title: string | null;
  summary: string | null;
  captured_at: string;
  updated_at: string;
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

  useEffect(() => {
    fetch(`${API}/api/documents`)
      .then((r) => r.json())
      .then((d) => setDocs(d.documents))
      .catch(() => setError("Failed to load saved pages."))
      .finally(() => setLoading(false));
  }, []);

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
        <Link to="/">← Search</Link>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
      {!loading && !error && docs.length === 0 && <p style={{ color: "#666" }}>No pages saved yet.</p>}

      {docs.map((doc) => (
        <article key={doc.id} style={{ marginBottom: "0.75rem", padding: "0.75rem 1rem", border: "1px solid #e0e0e0", borderRadius: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
              {doc.title || doc.url}
            </a>
            <button
              onClick={() => handleDelete(doc.id)}
              disabled={deleting.has(doc.id)}
              style={{ marginLeft: "1rem", padding: "2px 10px", fontSize: "0.8rem", background: "none", border: "1px solid #ccc", borderRadius: 4, cursor: "pointer", color: "#c00", whiteSpace: "nowrap" }}
            >
              {deleting.has(doc.id) ? "Deleting…" : "Delete"}
            </button>
          </div>
          {doc.summary && (
            <div style={{ margin: "0.5rem 0 0.25rem", fontSize: "0.85rem", lineHeight: 1.6, color: "#555", background: "#f8f8f8", borderRadius: 4, padding: "0.5rem 0.75rem", whiteSpace: "pre-line" }}>
              {doc.summary}
            </div>
          )}
          <div style={{ fontSize: "0.75rem", color: "#888", marginTop: "0.25rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <span>Saved {new Date(doc.captured_at).toLocaleDateString()}</span>
            {doc.doi && <span>DOI: {doc.doi}</span>}
            <span style={{ wordBreak: "break-all" }}>{doc.url}</span>
          </div>
        </article>
      ))}
    </>
  );
}
