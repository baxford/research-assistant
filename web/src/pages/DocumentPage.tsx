import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Layout from "../components/Layout";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

interface Document {
  id: string;
  url: string;
  doi: string | null;
  title: string | null;
  summary: string | null;
  captured_at: string;
  updated_at: string;
  authors: string | null;
  published_at: string | null;
}

interface Chunk {
  id: string;
  ordinal: number;
  text: string;
}

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Document | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) {
      setError("Missing document id.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch(`${API}/api/documents/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setDoc(d.document ?? null);
        setChunks(Array.isArray(d.chunks) ? d.chunks : []);
      })
      .catch(() => {
        if (!cancelled) setError("Document not found.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleDelete() {
    if (!doc) return;
    setDeleting(true);
    try {
      const res = await fetch(`${API}/api/documents/${doc.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      navigate("/saved");
    } catch {
      setError("Failed to delete document.");
      setDeleting(false);
    }
  }

  if (loading) return <p>Loading…</p>;
  if (error || !doc) return (
    <p style={{ color: "red" }}>{error ?? "Document not found."}</p>
  );

  return (
    <Layout
      actions={
        <button
          onClick={handleDelete}
          disabled={deleting}
          style={{ padding: "4px 14px", fontSize: "0.85rem", background: "none", border: "1px solid #ccc", borderRadius: 4, cursor: "pointer", color: "#c00" }}
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      }
    >

      <article style={{ marginBottom: "1.5rem", padding: "1rem 1.25rem", border: "1px solid #e0e0e0", borderRadius: 6 }}>
        <h2 style={{ margin: "0 0 0.5rem" }}>
          <a href={doc.url} target="_blank" rel="noopener noreferrer">
            {doc.title || doc.url}
          </a>
        </h2>
        {doc.summary && (
          <div style={{ margin: "0.5rem 0 0.75rem", fontSize: "0.9rem", lineHeight: 1.7, color: "#555", background: "#f8f8f8", borderRadius: 4, padding: "0.6rem 0.85rem", whiteSpace: "pre-line" }}>
            {doc.summary}
          </div>
        )}
        <div style={{ fontSize: "0.75rem", color: "#888", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          {doc.authors && <span>Authors: {doc.authors}</span>}
          {doc.published_at && <span>Published: {new Date(doc.published_at).toLocaleDateString()}</span>}
          {doc.doi && <span>DOI: {doc.doi}</span>}
          <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ wordBreak: "break-all" }}>
            {doc.url}
          </a>
          <span>Saved: {new Date(doc.updated_at).toLocaleDateString()}</span>
        </div>
      </article>

      <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem", color: "#444" }}>
        Chunks <span style={{ fontWeight: 400, color: "#999" }}>({chunks.length})</span>
      </h3>

      {chunks.length === 0 && (
        <p style={{ color: "#666" }}>No chunks stored for this document.</p>
      )}

      {chunks.map((chunk) => (
        <div
          key={chunk.id}
          style={{ marginBottom: "0.5rem", padding: "0.65rem 0.85rem", border: "1px solid #e8e8e8", borderRadius: 5, fontSize: "0.875rem", lineHeight: 1.6, color: "#333" }}
        >
          <div style={{ fontSize: "0.7rem", color: "#aaa", marginBottom: "0.3rem" }}>#{chunk.ordinal + 1}</div>
          {chunk.text}
        </div>
      ))}
    </Layout>
  );
}
