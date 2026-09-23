let allLinks = [];
let activeDomains = new Set();

// ── On Load ────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  await loadActiveTabs();
  await loadAndRender();
  setupSearch();
  setupExport();
});

// ── Active Tabs ────────────────────────────────────────────

async function loadActiveTabs() {
  const tabs = await chrome.tabs.query({});
  activeDomains.clear();
  for (const tab of tabs) {
    if (!tab.url?.startsWith("http")) continue;
    try {
      activeDomains.add(new URL(tab.url).hostname.replace(/^www\./, ""));
    } catch (_) {}
  }
}

// ── Load and Render ────────────────────────────────────────

async function loadAndRender() {
  const { links = [] } = await chrome.storage.local.get("links");
  allLinks = links;
  renderGrid(allLinks);
}

function renderGrid(links) {
  const grid = document.getElementById("grid");
  const emptyState = document.getElementById("emptyState");
  const siteCount = document.getElementById("siteCount");

  grid.innerHTML = "";

  if (links.length === 0) {
    emptyState.classList.remove("hidden");
    siteCount.textContent = "";
    return;
  }

  emptyState.classList.add("hidden");
  siteCount.textContent = `${links.length} saved site${links.length !== 1 ? "s" : ""}`;

  for (const entry of links) {
    const domain = Object.keys(entry)[0];
    const [description, faviconUrl, url] = entry[domain];

    const card = document.createElement("div");
    card.className = "site-card";
    card.title = description;
    if (activeDomains.has(domain)) card.classList.add("is-open");

    const img = document.createElement("img");
    img.className = "site-icon";
    img.src = faviconUrl;
    img.alt = domain;
    img.onerror = () => {
      img.style.display = "none";
      const fallback = document.createElement("div");
      fallback.className = "site-icon-fallback";
      fallback.textContent = domain[0];
      card.insertBefore(fallback, card.firstChild);
    };

    const label = document.createElement("div");
    label.className = "site-label";
    label.textContent = domain;

    card.appendChild(img);
    card.appendChild(label);
    card.addEventListener("click", () => openOrSwitchTab(domain, url));
    grid.appendChild(card);
  }
}

// ── Open or Switch Tab ─────────────────────────────────────

async function openOrSwitchTab(domain, url) {
  const allTabs = await chrome.tabs.query({});
  const match = allTabs.find((tab) => {
    if (!tab.url?.startsWith("http")) return false;
    try {
      return new URL(tab.url).hostname.replace(/^www\./, "") === domain;
    } catch (_) {
      return false;
    }
  });

  if (match) {
    await chrome.tabs.update(match.id, { active: true });
    await chrome.windows.update(match.windowId, { focused: true });
  } else {
    chrome.tabs.create({ url });
  }

  window.close();
}

// ── Export ─────────────────────────────────────────────────

function setupExport() {
  document.getElementById("exportBtn").addEventListener("click", exportLinks);
}

function exportLinks() {
  const btn = document.getElementById("exportBtn");

  if (allLinks.length === 0) {
    flashBtn(btn, "empty");
    return;
  }

  const exportData = {};
  for (const entry of allLinks) {
    const domain = Object.keys(entry)[0];
    const [description] = entry[domain];
    exportData[domain] = description;
  }

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json",
  });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `sitevault-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(anchor.href);

  flashBtn(btn, "success");
}

function flashBtn(btn, type) {
  btn.classList.add(type);
  setTimeout(() => btn.classList.remove(type), 1500);
}

// ── Search ─────────────────────────────────────────────────

function setupSearch() {
  const input = document.getElementById("searchInput");
  const clearBtn = document.getElementById("clearSearch");

  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    clearBtn.classList.toggle("visible", !!query);

    if (!query) {
      renderGrid(allLinks);
      return;
    }

    renderGrid(
      allLinks.filter((entry) => {
        const domain = Object.keys(entry)[0];
        const [description] = entry[domain];
        return (
          domain.includes(query) || description.toLowerCase().includes(query)
        );
      }),
    );
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.classList.remove("visible");
    renderGrid(allLinks);
    input.focus();
  });
}
