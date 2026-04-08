const API_BASE = "http://localhost:3001";
const LAST_COLLECTION_KEY = "researcher_last_collection";
const NEW_COLLECTION_VALUE = "__new__";

const urlEl = document.getElementById("url");
const doiEl = document.getElementById("doi");
const saveBtn = document.getElementById("save-btn");
const forceCheckbox = document.getElementById("force-checkbox");
const statusEl = document.getElementById("status");
const collectionSelect = document.getElementById("collection-select");
const newCollectionArea = document.getElementById("new-collection-area");
const newCollectionName = document.getElementById("new-collection-name");
const createCollectionBtn = document.getElementById("create-collection-btn");

function setStatus(msg, type = "info") {
  statusEl.textContent = msg;
  statusEl.className = type;
}

function populateCollections(collections) {
  collectionSelect.innerHTML = "";
  for (const col of collections) {
    const opt = document.createElement("option");
    opt.value = col.id;
    opt.textContent = col.name;
    collectionSelect.appendChild(opt);
  }
  const newOpt = document.createElement("option");
  newOpt.value = NEW_COLLECTION_VALUE;
  newOpt.textContent = "＋ New collection…";
  collectionSelect.appendChild(newOpt);
  collectionSelect.disabled = false;

  const saved = localStorage.getItem(LAST_COLLECTION_KEY);
  if (saved && [...collectionSelect.options].some((o) => o.value === saved)) {
    collectionSelect.value = saved;
  }
  handleCollectionChange();
}

function handleCollectionChange() {
  const isNew = collectionSelect.value === NEW_COLLECTION_VALUE;
  newCollectionArea.style.display = isNew ? "block" : "none";
  createCollectionBtn.disabled = !newCollectionName.value.trim();
  if (!isNew) {
    localStorage.setItem(LAST_COLLECTION_KEY, collectionSelect.value);
  }
}

collectionSelect.addEventListener("change", handleCollectionChange);
newCollectionName.addEventListener("input", () => {
  createCollectionBtn.disabled = !newCollectionName.value.trim();
});

createCollectionBtn.addEventListener("click", async () => {
  const name = newCollectionName.value.trim();
  if (!name) return;
  createCollectionBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const data = await res.json();
    const newCol = data.collection;

    // Add to select before the "new" option
    const newOpt = collectionSelect.querySelector(`[value="${NEW_COLLECTION_VALUE}"]`);
    const opt = document.createElement("option");
    opt.value = newCol.id;
    opt.textContent = newCol.name;
    collectionSelect.insertBefore(opt, newOpt);
    collectionSelect.value = newCol.id;
    newCollectionArea.style.display = "none";
    newCollectionName.value = "";
    localStorage.setItem(LAST_COLLECTION_KEY, newCol.id);
    setStatus(`Collection "${newCol.name}" created.`, "success");
  } catch (err) {
    setStatus(`Failed to create collection: ${err.message}`, "error");
    createCollectionBtn.disabled = false;
  }
});

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    urlEl.textContent = "Cannot save this page.";
    setStatus("Extension pages cannot be saved.", "error");
    return;
  }

  urlEl.textContent = tab.url;

  // Load collections
  try {
    const res = await fetch(`${API_BASE}/api/collections`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    populateCollections(data.collections);
    saveBtn.disabled = false;
  } catch {
    collectionSelect.innerHTML = "<option>Failed to load collections</option>";
    setStatus("Could not reach API. Is it running?", "error");
    return;
  }

  saveBtn.addEventListener("click", async () => {
    const selectedCollectionId = collectionSelect.value;
    if (!selectedCollectionId || selectedCollectionId === NEW_COLLECTION_VALUE) {
      setStatus("Please select or create a collection first.", "error");
      return;
    }

    saveBtn.disabled = true;
    setStatus("Capturing page…", "info");

    let result;
    try {
      [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: capturePageContent,
      });
    } catch (err) {
      setStatus("Failed to capture page content.", "error");
      saveBtn.disabled = false;
      return;
    }

    const { html, title, doi } = result.result;

    if (doi) {
      doiEl.textContent = `DOI: ${doi}`;
    }

    setStatus("Saving…", "info");

    try {
      const res = await fetch(`${API_BASE}/api/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: tab.url,
          title: title || tab.title,
          doi: doi || undefined,
          capturedAt: new Date().toISOString(),
          html,
          force: forceCheckbox.checked || undefined,
          collection_id: selectedCollectionId,
        }),
      });

      if (!res.ok) {
        throw new Error(`API returned ${res.status}`);
      }

      const data = await res.json();

      if (data.status === "skipped") {
        setStatus("Already up to date — no changes detected.", "info");
        saveBtn.disabled = false;
      } else {
        setStatus(`Saved! (${data.chunks} chunks indexed)`, "success");
      }
    } catch (err) {
      setStatus(`Error: ${err.message}. Is the API running?`, "error");
      saveBtn.disabled = false;
    }
  });
}

// This function is serialised and injected into the page — keep it self-contained
function capturePageContent() {
  const html = document.documentElement.outerHTML;
  const title = document.title;

  const doiSelectors = [
    'meta[name="citation_doi"]',
    'meta[name="dc.identifier"]',
    'meta[name="DC.Identifier"]',
    'meta[name="prism.doi"]',
    'meta[scheme="doi"]',
  ];

  let doi = null;
  for (const selector of doiSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      const val = el.getAttribute("content") || el.getAttribute("value") || "";
      const cleaned = val.replace(/^doi:\s*/i, "").trim();
      if (cleaned.startsWith("10.")) {
        doi = cleaned;
        break;
      }
    }
  }

  if (!doi) {
    const doiLink = document.querySelector('a[href^="https://doi.org/10."]');
    if (doiLink) {
      doi = doiLink.getAttribute("href").replace("https://doi.org/", "");
    }
  }

  return { html, title, doi };
}

init();
