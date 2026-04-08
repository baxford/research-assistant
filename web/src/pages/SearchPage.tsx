import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";

const HISTORY_KEY = "researcher_search_history";
const MAX_HISTORY = 20;

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveToHistory(q: string) {
  const trimmed = q.trim();
  if (!trimmed) return;
  const prev = loadHistory().filter((h) => h !== trimmed);
  localStorage.setItem(HISTORY_KEY, JSON.stringify([trimmed, ...prev].slice(0, MAX_HISTORY)));
}

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

interface SearchResult {
  chunkId: string;
  text: string;
  documentId: string;
  documentUrl: string;
  documentTitle: string | null;
  summary: string | null;
  doi: string | null;
  savedAt: string;
  score: number;
  matchType: "vector" | "fts" | "both";
}

interface DocumentResult {
  documentId: string;
  documentUrl: string;
  documentTitle: string | null;
  summary: string | null;
  doi: string | null;
  savedAt: string;
  bestChunk: string;
  matchType: "vector" | "fts" | "both";
}

const badgeColors: Record<string, string> = {
  both: "#d4edda",
  vector: "#cce5ff",
  fts: "#fff3cd",
};

function deduplicateByDocument(results: SearchResult[]): DocumentResult[] {
  const seen = new Map<string, DocumentResult>();
  for (const r of results) {
    if (!seen.has(r.documentUrl)) {
      seen.set(r.documentUrl, {
        documentId: r.documentId,
        documentUrl: r.documentUrl,
        documentTitle: r.documentTitle,
        summary: r.summary,
        doi: r.doi,
        savedAt: r.savedAt,
        bestChunk: r.text,
        matchType: r.matchType,
      });
    }
  }
  return Array.from(seen.values());
}

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [results, setResults] = useState<DocumentResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const formRef = useRef<HTMLDivElement>(null);

  async function runSearch(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setShowHistory(false);
    saveToHistory(q);
    setHistory(loadHistory());
    try {
      const res = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      setResults(deduplicateByDocument(data.results));
      setSearched(true);
    } catch {
      setError("Search failed — is the API running? Check http://localhost:3001/api/health");
    } finally {
      setLoading(false);
    }
  }

  // Run search on mount if query is in the URL
  useEffect(() => {
    const q = searchParams.get("q");
    if (q) runSearch(q);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (formRef.current && !formRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSearchParams(query.trim() ? { q: query } : {});
    runSearch(query);
  }

  async function handleDelete(documentId: string) {
    setDeleting((prev) => new Set(prev).add(documentId));
    try {
      const res = await fetch(`${API}/api/documents/${documentId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setResults((prev) => prev.filter((r) => r.documentId !== documentId));
    } catch {
      setError("Failed to delete document.");
    } finally {
      setDeleting((prev) => { const next = new Set(prev); next.delete(documentId); return next; });
    }
  }

  function selectHistory(item: string) {
    setQuery(item);
    setSearchParams({ q: item });
    runSearch(item);
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Researcher</h1>
        <Link to="/saved">Saved pages →</Link>
      </div>

      <div ref={formRef} style={{ position: "relative", marginBottom: "2rem" }}>
        <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setShowHistory(history.length > 0)}
            placeholder="Search your saved pages…"
            style={{ flex: 1, marginBottom: 0 }}
            autoFocus
          />
          <button type="submit" disabled={loading} style={{ width: "auto" }}>
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        {showHistory && (
          <ul style={{
            position: "absolute", top: "100%", left: 0,
            right: "6rem", // align with input right edge (roughly button width)
            margin: "2px 0 0", padding: 0, listStyle: "none",
            border: "1px solid #d0d0d0", borderRadius: 4,
            background: "#fff", boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            zIndex: 100, maxHeight: "16rem", overflowY: "auto",
          }}>
            {history.map((item) => (
              <li
                key={item}
                onMouseDown={(e) => { e.preventDefault(); selectHistory(item); }}
                style={{
                  padding: "0.5rem 0.75rem", cursor: "pointer",
                  fontSize: "0.9rem", borderBottom: "1px solid #f0f0f0",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}
              >
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <article style={{ background: "#fee2e2", border: "1px solid #fca5a5", padding: "1rem", borderRadius: 4 }}>
          {error}
        </article>
      )}

      {!error && searched && results.length === 0 && (
        <p style={{ color: "#666" }}>No results found. Try a different query, or save some pages with the Chrome extension first.</p>
      )}

      {results.map((r) => (
        <article key={r.documentUrl} style={{ marginBottom: "1rem", padding: "1rem", border: "1px solid #e0e0e0", borderRadius: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
            <a href={r.documentUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, fontSize: "0.95rem" }}>
              {r.documentTitle || r.documentUrl}
            </a>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "0.5rem", flexShrink: 0 }}>
              <span style={{
                fontSize: "0.7rem", padding: "2px 6px", borderRadius: 3,
                background: badgeColors[r.matchType] || "#eee",
                color: "#333", whiteSpace: "nowrap",
              }}>
                {r.matchType}
              </span>
              <button
                onClick={() => handleDelete(r.documentId)}
                disabled={deleting.has(r.documentId)}
                style={{ padding: "2px 10px", fontSize: "0.8rem", background: "none", border: "1px solid #ccc", borderRadius: 4, cursor: "pointer", color: "#c00", whiteSpace: "nowrap" }}
              >
                {deleting.has(r.documentId) ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
          {r.summary && (
            <div style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", lineHeight: 1.6, color: "#555", background: "#f8f8f8", borderRadius: 4, padding: "0.5rem 0.75rem", whiteSpace: "pre-line" }}>
              {r.summary}
            </div>
          )}
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.9rem", lineHeight: 1.5, color: "#333" }}>{r.bestChunk}</p>
          <div style={{ fontSize: "0.75rem", color: "#888", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <span>{new Date(r.savedAt).toLocaleDateString()}</span>
            {r.doi && <span>DOI: {r.doi}</span>}
            <a href={r.documentUrl} target="_blank" rel="noopener noreferrer" style={{ wordBreak: "break-all" }}>
              {r.documentUrl}
            </a>
          </div>
        </article>
      ))}

      {!searched && !error && (
        <p style={{ color: "#999", marginTop: "2rem" }}>Save pages with the Chrome extension, then search here.</p>
      )}
    </>
  );
}
