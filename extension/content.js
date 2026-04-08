// Injected into the active tab to capture page content and metadata
(() => {
  const html = document.documentElement.outerHTML;
  const title = document.title;

  // Try to extract DOI from common meta tags
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
      // Normalise: strip leading "doi:" or "DOI:" prefix
      const cleaned = val.replace(/^doi:\s*/i, "").trim();
      if (cleaned.startsWith("10.")) {
        doi = cleaned;
        break;
      }
    }
  }

  // Also check <a> links with href starting with https://doi.org/
  if (!doi) {
    const doiLink = document.querySelector('a[href^="https://doi.org/10."]');
    if (doiLink) {
      doi = doiLink.getAttribute("href").replace("https://doi.org/", "");
    }
  }

  return { html, title, doi };
})();
