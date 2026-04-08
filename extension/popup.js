const API_BASE = "http://localhost:3001";

const urlEl = document.getElementById("url");
const doiEl = document.getElementById("doi");
const saveBtn = document.getElementById("save-btn");
const statusEl = document.getElementById("status");

function setStatus(msg, type = "info") {
  statusEl.textContent = msg;
  statusEl.className = type;
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    urlEl.textContent = "Cannot save this page.";
    setStatus("Extension pages cannot be saved.", "error");
    return;
  }

  urlEl.textContent = tab.url;
  saveBtn.disabled = false;

  saveBtn.addEventListener("click", async () => {
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
        }),
      });

      if (!res.ok) {
        throw new Error(`API returned ${res.status}`);
      }

      const data = await res.json();

      if (data.status === "skipped") {
        setStatus("Already up to date — no changes detected.", "info");
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
