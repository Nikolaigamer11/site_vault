let iconToken = 0;
let defaultIconCache = null;
let cycleIndex = -1;
let cycleTabId = null;
let cycleTimeout = null;

// ── Favicon URL ────────────────────────────────────────────

function getFaviconUrl(pageUrl, size = 32) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", String(size));
  return url.toString();
}

// ── Binary Insertion Sort ──────────────────────────────────

function findInsertionIndex(links, domain) {
  let low = 0;
  let high = links.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midKey = Object.keys(links[mid])[0];
    if (domain < midKey) high = mid;
    else low = mid + 1;
  }
  return low;
}

function binarySearch(links, domain) {
  let low = 0;
  let high = links.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midKey = Object.keys(links[mid])[0];
    if (midKey === domain) return mid;
    else if (domain < midKey) high = mid - 1;
    else low = mid + 1;
  }
  return -1;
}

// ── Icon Utilities ─────────────────────────────────────────
// ── Icon Utilities ─────────────────────────────────────────

const ICON_SIZES = [16, 32];

function bitmapToImageDataSet(bitmap) {
  const set = {};
  for (const size of ICON_SIZES) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, size, size);
    set[size] = ctx.getImageData(0, 0, size, size);
  }
  return set;
}

async function getDefaultIconImageData() {
  if (defaultIconCache) return defaultIconCache;
  const response = await fetch(chrome.runtime.getURL("icons/icon128.png"));
  const bitmap = await createImageBitmap(await response.blob());
  defaultIconCache = bitmapToImageDataSet(bitmap);
  return defaultIconCache;
}

async function resetToDefaultIcon(tabId) {
  const myToken = ++iconToken;
  try {
    const imageData = await getDefaultIconImageData();
    if (myToken !== iconToken) return;
    await chrome.action.setIcon({ imageData, tabId });
    if (myToken === iconToken) chrome.action.setBadgeText({ text: "", tabId });
  } catch (_) {}
}

async function applyFaviconAsIcon(pageUrl, tabId) {
  const myToken = ++iconToken;
  try {
    const response = await fetch(getFaviconUrl(pageUrl, 64));
    const bitmap = await createImageBitmap(await response.blob());
    if (myToken !== iconToken) return;
    chrome.action.setIcon({ imageData: bitmapToImageDataSet(bitmap), tabId });
  } catch (_) {
    if (myToken !== iconToken) return;
    await resetToDefaultIcon(tabId);
  }
}

// ── Popup / Click Mode ─────────────────────────────────────

async function enableClickMode() {
  await chrome.action.setPopup({ popup: "" });
}

async function enablePopupMode() {
  await chrome.action.setPopup({ popup: "popup.html" });
}

// ── Cycle State ────────────────────────────────────────────

async function clearCycleState() {
  cycleIndex = -1;
  cycleTabId = null;
  if (cycleTimeout) {
    clearTimeout(cycleTimeout);
    cycleTimeout = null;
  }
  await enablePopupMode();
}

async function resetCycle(tabId) {
  await clearCycleState();
  await handleTabIconUpdate(tabId);
}

function restartCycleTimer() {
  if (cycleTimeout) clearTimeout(cycleTimeout);
  cycleTimeout = setTimeout(onCycleCooldownExpired, 5000);
}

async function onCycleCooldownExpired() {
  cycleTimeout = null;
  const tabId = cycleTabId;
  cycleIndex = -1;
  cycleTabId = null;
  await enablePopupMode();

  if (tabId == null) return;

  await resetToDefaultIcon(tabId);

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (_) {
    return;
  }

  if (!tab?.url?.startsWith("http")) return;

  let domain, fullUrl;
  try {
    const urlObj = new URL(tab.url);
    domain = urlObj.hostname.replace(/^www\./, "");
    fullUrl = tab.url;
  } catch (_) {
    return;
  }

  const { links = [] } = await chrome.storage.local.get("links");

  if (binarySearch(links, domain) !== -1) {
    await applyFaviconAsIcon(fullUrl, tabId);
  }
}

async function showCycledSite(tabId, links) {
  if (cycleIndex < 0 || cycleIndex >= links.length) return;
  const domain = Object.keys(links[cycleIndex])[0];
  const [, , fullUrl] = links[cycleIndex][domain];
  cycleTabId = tabId;
  await enableClickMode();
  await applyFaviconAsIcon(fullUrl, tabId);
  restartCycleTimer();
}

async function openCycledSite(tab) {
  const { links = [] } = await chrome.storage.local.get("links");
  if (cycleIndex < 0 || cycleIndex >= links.length) return;

  const domain = Object.keys(links[cycleIndex])[0];
  const [, , fullUrl] = links[cycleIndex][domain];

  const allTabs = await chrome.tabs.query({});
  const match = allTabs.find((t) => {
    if (!t.url?.startsWith("http")) return false;
    try {
      return new URL(t.url).hostname.replace(/^www\./, "") === domain;
    } catch (_) {
      return false;
    }
  });

  if (match) {
    await chrome.tabs.update(match.id, { active: true });
    await chrome.windows.update(match.windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: fullUrl });
  }

  await resetCycle(tab.id);
}

// ── Tab Icon State ─────────────────────────────────────────

async function handleTabIconUpdate(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (_) {
    return;
  }

  if (!tab?.url?.startsWith("http")) {
    await resetToDefaultIcon(tabId);
    return;
  }

  let domain, fullUrl;
  try {
    const urlObj = new URL(tab.url);
    domain = urlObj.hostname.replace(/^www\./, "");
    fullUrl = tab.url;
  } catch (_) {
    await resetToDefaultIcon(tabId);
    return;
  }

  const { links = [] } = await chrome.storage.local.get("links");

  if (binarySearch(links, domain) !== -1) {
    await applyFaviconAsIcon(fullUrl, tabId);
  } else {
    await resetToDefaultIcon(tabId);
  }
}

// ── Tab Events ─────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await resetCycle(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    await resetCycle(tabId);
  }
});

// ── Extension Icon Click ───────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  if (cycleIndex === -1) return;
  await openCycledSite(tab);
});

// ── Commands ───────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const { links = [] } = await chrome.storage.local.get("links");

  if (command === "cycle-prev") {
    if (links.length === 0) return;
    cycleIndex =
      cycleIndex === -1
        ? links.length - 1
        : (cycleIndex - 1 + links.length) % links.length;
    await showCycledSite(tab.id, links);
    return;
  }

  if (command === "cycle-next") {
    if (links.length === 0) return;
    cycleIndex = cycleIndex === -1 ? 0 : (cycleIndex + 1) % links.length;
    await showCycledSite(tab.id, links);
    return;
  }

  if (command === "open-cycled-site") {
    if (cycleIndex === -1) return;
    await openCycledSite(tab);
    return;
  }

  if (command === "toggle-save-site") {
    await clearCycleState();

    let urlObj;
    try {
      urlObj = new URL(tab.url);
    } catch (_) {
      return;
    }

    const domain = urlObj.hostname.replace(/^www\./, "");
    const fullUrl = tab.url;
    const idx = binarySearch(links, domain);

    if (idx !== -1) {
      links.splice(idx, 1);
      await chrome.storage.local.set({ links });
      await resetToDefaultIcon(tab.id);
      chrome.action.setBadgeText({ text: "DEL", tabId: tab.id });
      chrome.action.setBadgeBackgroundColor({
        color: "#c0392b",
        tabId: tab.id,
      });
      setTimeout(
        () => chrome.action.setBadgeText({ text: "", tabId: tab.id }),
        1500,
      );
    } else {
      let description = tab.title || domain;
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const meta =
              document.querySelector('meta[name="description"]') ||
              document.querySelector('meta[property="og:description"]');
            return meta?.content?.trim() || document.title;
          },
        });
        if (results?.[0]?.result) description = results[0].result;
      } catch (_) {}

      const favicon = getFaviconUrl(fullUrl, 32);
      const insertAt = findInsertionIndex(links, domain);
      links.splice(insertAt, 0, { [domain]: [description, favicon, fullUrl] });
      await chrome.storage.local.set({ links });
      await applyFaviconAsIcon(fullUrl, tab.id);
      chrome.action.setBadgeText({ text: "SAV", tabId: tab.id });
      chrome.action.setBadgeBackgroundColor({
        color: "#27ae60",
        tabId: tab.id,
      });
      setTimeout(
        () => chrome.action.setBadgeText({ text: "", tabId: tab.id }),
        1500,
      );
    }
  }
});
