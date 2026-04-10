import { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:3001';
const LAST_COLLECTION_KEY = 'researcher_last_collection';
const LAST_SECTION_ROOT_KEY = 'researcher_last_section_root';

interface Collection {
  id: string;
  name: string;
}

interface Section {
  id: string;
  parent_id: string | null;
  name: string;
  depth: number;
  position: number;
}

// Injected into the active page — must be completely self-contained (no imports/closures).
function extractDoi(): string | null {
  const selectors = [
    'meta[name="citation_doi"]',
    'meta[name="dc.identifier"]',
    'meta[name="DC.Identifier"]',
    'meta[name="prism.doi"]',
    'meta[scheme="doi"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const val = el.getAttribute('content') || el.getAttribute('value') || '';
      const cleaned = val.replace(/^doi:\s*/i, '').trim();
      if (cleaned.startsWith('10.')) return cleaned;
    }
  }
  const link = document.querySelector('a[href^="https://doi.org/10."]');
  if (link) return link.getAttribute('href')!.replace('https://doi.org/', '');
  return null;
}

// Injected into the active page — must be completely self-contained (no imports/closures).
function capturePageContent(): { html: string; title: string; doi: string | null } {
  const html = document.documentElement.outerHTML;
  const title = document.title;
  const selectors = [
    'meta[name="citation_doi"]',
    'meta[name="dc.identifier"]',
    'meta[name="DC.Identifier"]',
    'meta[name="prism.doi"]',
    'meta[scheme="doi"]',
  ];
  let doi: string | null = null;
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const val = el.getAttribute('content') || el.getAttribute('value') || '';
      const cleaned = val.replace(/^doi:\s*/i, '').trim();
      if (cleaned.startsWith('10.')) { doi = cleaned; break; }
    }
  }
  if (!doi) {
    const link = document.querySelector('a[href^="https://doi.org/10."]');
    if (link) doi = link.getAttribute('href')!.replace('https://doi.org/', '');
  }
  return { html, title, doi };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Returns all descendants of rootId in tree order, given a pre-sorted flat section list.
// The API returns sections in tree order (parents before children), so a single pass suffices.
function getDescendants(sections: Section[], rootId: string): Section[] {
  const inSubtree = new Set<string>([rootId]);
  return sections.filter(s => {
    if (s.parent_id !== null && inSubtree.has(s.parent_id)) {
      inSubtree.add(s.id);
      return true;
    }
    return false;
  });
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Popup() {
  const [tabUrl, setTabUrl] = useState<string | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [tabTitle, setTabTitle] = useState('');
  const [tabError, setTabError] = useState<string | null>(null);
  const [doi, setDoi] = useState<string | null>(null);
  const [savedStatus, setSavedStatus] = useState<{ found: boolean; updated_at?: string } | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState('');
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [allSections, setAllSections] = useState<Section[]>([]);
  const [selectedRootId, setSelectedRootId] = useState('');
  const [selectedSectionIds, setSelectedSectionIds] = useState<Set<string>>(new Set());
  const [force, setForce] = useState(false);
  const [status, setStatus] = useState<{ msg: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => { init(); }, []);

  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      setTabError('Cannot save this page.');
      return;
    }

    setTabUrl(tab.url);
    setTabId(tab.id ?? null);
    setTabTitle(tab.title ?? '');

    const [collectionsResult, , sectionsResult] = await Promise.allSettled([
      fetch(`${API_BASE}/api/collections`).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      checkSavedStatus(tab.id!, tab.url),
      fetch(`${API_BASE}/api/sections`).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    ]);

    if (collectionsResult.status === 'rejected') {
      setApiError('Could not reach API — is the stack running?');
      return;
    }

    const cols: Collection[] = collectionsResult.value.collections ?? [];
    setCollections(cols);
    const savedCol = localStorage.getItem(LAST_COLLECTION_KEY);
    setSelectedCollectionId(cols.find(c => c.id === savedCol) ? savedCol! : (cols[0]?.id ?? ''));

    if (sectionsResult.status === 'fulfilled') {
      const secs: Section[] = sectionsResult.value.sections ?? [];
      setAllSections(secs);
      const roots = secs.filter(s => s.parent_id === null);
      const savedRoot = localStorage.getItem(LAST_SECTION_ROOT_KEY);
      setSelectedRootId(roots.find(r => r.id === savedRoot) ? savedRoot! : '');
    }

    setReady(true);
  }

  async function checkSavedStatus(tid: number, url: string) {
    let foundDoi: string | null = null;
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tid }, func: extractDoi });
      foundDoi = r?.result ?? null;
    } catch { /* scripting blocked on some pages */ }
    if (foundDoi) setDoi(foundDoi);

    const params = new URLSearchParams({ url });
    if (foundDoi) params.set('doi', foundDoi);
    try {
      const res = await fetch(`${API_BASE}/api/documents/lookup?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setSavedStatus(data.found ? { found: true, updated_at: data.document.updated_at } : { found: false });
    } catch { /* silent */ }
  }

  async function handleCreateCollection() {
    const name = newCollectionName.trim();
    if (!name) return;
    try {
      const res = await fetch(`${API_BASE}/api/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const col: Collection = data.collection;
      setCollections(prev => [...prev, col]);
      setSelectedCollectionId(col.id);
      setShowNewCollection(false);
      setNewCollectionName('');
      localStorage.setItem(LAST_COLLECTION_KEY, col.id);
      setStatus({ msg: `Collection "${col.name}" created.`, type: 'success' });
    } catch (err: unknown) {
      setStatus({ msg: `Failed to create collection: ${(err as Error).message}`, type: 'error' });
    }
  }

  function handleRootChange(rootId: string) {
    setSelectedRootId(rootId);
    setSelectedSectionIds(new Set());
    if (rootId) {
      localStorage.setItem(LAST_SECTION_ROOT_KEY, rootId);
    } else {
      localStorage.removeItem(LAST_SECTION_ROOT_KEY);
    }
  }

  function toggleSection(id: string) {
    setSelectedSectionIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (!tabId || !tabUrl || !selectedCollectionId || saving) return;
    setSaving(true);
    setStatus({ msg: 'Capturing page…', type: 'info' });

    let captured: { html: string; title: string; doi: string | null };
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: capturePageContent });
      captured = r.result;
    } catch {
      setStatus({ msg: 'Failed to capture page content.', type: 'error' });
      setSaving(false);
      return;
    }

    if (captured.doi) setDoi(captured.doi);
    setStatus({ msg: 'Saving…', type: 'info' });

    // Build section_ids: selected children + the root itself if no children selected
    const sectionIds = selectedSectionIds.size > 0
      ? [...selectedSectionIds]
      : selectedRootId && childSections.length === 0
        ? [selectedRootId]
        : [];

    try {
      const res = await fetch(`${API_BASE}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: tabUrl,
          title: captured.title || tabTitle,
          doi: captured.doi || undefined,
          capturedAt: new Date().toISOString(),
          html: captured.html,
          force: force || undefined,
          collection_id: selectedCollectionId,
          section_ids: sectionIds.length > 0 ? sectionIds : undefined,
        }),
      });
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data = await res.json();

      if (data.status === 'skipped') {
        const note = sectionIds.length > 0 ? ' (sections linked)' : '';
        setStatus({ msg: `Already up to date — no changes detected${note}.`, type: 'info' });
      } else {
        const sectionNote = sectionIds.length > 0
          ? `, linked to ${sectionIds.length} section${sectionIds.length > 1 ? 's' : ''}`
          : '';
        setStatus({ msg: `Saved! (${data.chunks} chunks indexed${sectionNote})`, type: 'success' });
        setSavedStatus({ found: true, updated_at: new Date().toISOString() });
      }
    } catch (err: unknown) {
      setStatus({ msg: `Error: ${(err as Error).message}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const rootSections = allSections.filter(s => s.parent_id === null);
  const childSections = selectedRootId ? getDescendants(allSections, selectedRootId) : [];

  // ── Render ──────────────────────────────────────────────────────────────────

  const body: React.CSSProperties = {
    width: 320, padding: 16,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: '#222', fontSize: 13,
  };

  if (tabError) return (
    <div style={body}>
      <h1 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Researcher</h1>
      <p style={{ color: '#c00' }}>{tabError}</p>
    </div>
  );

  const canSave = ready && !saving && !showNewCollection && !!selectedCollectionId;

  return (
    <div style={body}>
      <h1 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Researcher</h1>

      {tabUrl && (
        <div style={{ fontSize: 11, color: '#666', wordBreak: 'break-all', marginBottom: 10, lineHeight: 1.4 }}>
          {tabUrl}
        </div>
      )}
      {doi && (
        <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>DOI: {doi}</div>
      )}
      {savedStatus && (
        <div style={{ fontSize: 12, marginBottom: 10, color: savedStatus.found ? '#1a7340' : '#888' }}>
          {savedStatus.found
            ? `Already saved — last updated ${formatDate(savedStatus.updated_at!)}`
            : 'Not yet saved'}
        </div>
      )}

      {apiError ? (
        <p style={{ color: '#c00', marginBottom: 8 }}>{apiError}</p>
      ) : (
        <>
          {/* Collection */}
          <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>Collection</label>
          <select
            disabled={!ready}
            value={showNewCollection ? '__new__' : selectedCollectionId}
            onChange={e => {
              if (e.target.value === '__new__') {
                setShowNewCollection(true);
              } else {
                setShowNewCollection(false);
                setSelectedCollectionId(e.target.value);
                localStorage.setItem(LAST_COLLECTION_KEY, e.target.value);
              }
            }}
            style={{ width: '100%', padding: '5px 7px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4, background: '#fff', marginBottom: 8 }}
          >
            {!ready
              ? <option>Loading…</option>
              : collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)
            }
            <option value="__new__">＋ New collection…</option>
          </select>

          {showNewCollection && (
            <div style={{ marginBottom: 8 }}>
              <input
                autoFocus
                value={newCollectionName}
                onChange={e => setNewCollectionName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateCollection(); if (e.key === 'Escape') setShowNewCollection(false); }}
                placeholder="New collection name…"
                style={{ width: '100%', padding: '5px 7px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4, marginBottom: 5 }}
              />
              <button
                disabled={!newCollectionName.trim()}
                onClick={handleCreateCollection}
                style={{ width: '100%', padding: '5px 0', background: newCollectionName.trim() ? '#555' : '#aaa', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, cursor: newCollectionName.trim() ? 'pointer' : 'not-allowed', marginBottom: 4 }}
              >
                Create Collection
              </button>
            </div>
          )}

          {/* Section selector — only shown when sections exist */}
          {rootSections.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 4 }}>Project</label>
              <select
                value={selectedRootId}
                onChange={e => handleRootChange(e.target.value)}
                style={{ width: '100%', padding: '5px 7px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4, background: '#fff', marginBottom: childSections.length > 0 ? 5 : 0 }}
              >
                <option value="">— None —</option>
                {rootSections.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>

              {childSections.length > 0 && (
                <div style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 4, padding: '3px 0' }}>
                  {childSections.map(sec => (
                    <label
                      key={sec.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                        padding: `2px 8px 2px ${8 + (sec.depth - 1) * 12}px`,
                        background: selectedSectionIds.has(sec.id) ? '#e8f0fe' : undefined,
                        fontSize: 12,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSectionIds.has(sec.id)}
                        onChange={() => toggleSection(sec.id)}
                        style={{ margin: 0, flexShrink: 0 }}
                      />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sec.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Force re-index */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555', marginBottom: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} style={{ margin: 0 }} />
            Force re-index (overwrite existing)
          </label>

          <button
            disabled={!canSave}
            onClick={handleSave}
            style={{
              width: '100%', padding: '8px 0', border: 'none', borderRadius: 4,
              fontSize: 14, fontWeight: 500, cursor: canSave ? 'pointer' : 'not-allowed',
              background: canSave ? '#1a73e8' : '#aaa', color: '#fff',
            }}
          >
            {saving ? 'Saving…' : 'Save Page'}
          </button>
        </>
      )}

      {status && (
        <div style={{
          marginTop: 10, fontSize: 13, textAlign: 'center',
          color: status.type === 'success' ? '#1a7340' : status.type === 'error' ? '#c0392b' : '#888',
        }}>
          {status.msg}
        </div>
      )}
    </div>
  );
}
