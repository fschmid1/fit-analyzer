const CACHE_PREFIX = "fit-analyzer";
const CACHE_VERSION = "v2";
const UI_CACHE = `${CACHE_PREFIX}-ui-${CACHE_VERSION}`;
const ASSET_CACHE = `${CACHE_PREFIX}-assets-${CACHE_VERSION}`;
const FONT_CACHE = `${CACHE_PREFIX}-fonts-${CACHE_VERSION}`;

const APP_SHELL_URLS = ["/", "/index.html", "/favicon.svg", "/manifest.webmanifest"];
const SAME_ORIGIN_STATIC_PATHS = new Set([
  "/favicon.svg",
  "/manifest.webmanifest",
  "/vite.svg",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (cacheName) =>
                cacheName.startsWith(`${CACHE_PREFIX}-`) &&
                ![UI_CACHE, ASSET_CACHE, FONT_CACHE].includes(cacheName)
            )
            .map((cacheName) => caches.delete(cacheName))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin && url.pathname.startsWith("/api")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(appShellResponse(event));
    return;
  }

  if (isFontRequest(request, url)) {
    event.respondWith(staleWhileRevalidate(event, FONT_CACHE));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (isViteDevAssetRequest(request, url)) {
    event.respondWith(networkFirst(request, ASSET_CACHE));
  }
});

function isFontRequest(request, url) {
  return (
    request.destination === "font" ||
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  );
}

function isStaticAssetRequest(request, url) {
  if (url.origin !== self.location.origin) return false;

  return (
    url.pathname.startsWith("/assets/") ||
    SAME_ORIGIN_STATIC_PATHS.has(url.pathname)
  );
}

function isViteDevAssetRequest(request, url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === "/service-worker.js") return false;

  return (
    url.pathname.startsWith("/src/") ||
    url.pathname.startsWith("/@fs/") ||
    url.pathname.startsWith("/@id/") ||
    url.pathname.startsWith("/@vite/") ||
    url.pathname.startsWith("/node_modules/.vite/") ||
    url.pathname === "/@react-refresh" ||
    request.destination === "script" ||
    request.destination === "style"
  );
}

async function appShellResponse(event) {
  const cachedShell = await matchAppShell();
  const networkShell = fetchAndCacheAppShell();

  if (cachedShell) {
    event.waitUntil(networkShell.catch(() => undefined));
    return cachedShell;
  }

  try {
    return await networkShell;
  } catch {
    const fallbackShell = await matchAppShell();
    if (fallbackShell) return fallbackShell;
    throw new Error("App shell is unavailable.");
  }
}

async function matchAppShell() {
  const cache = await caches.open(UI_CACHE);
  return (await cache.match("/")) ?? (await cache.match("/index.html"));
}

async function precacheAppShell() {
  const cache = await caches.open(UI_CACHE);

  await Promise.all([
    fetchAndCacheAppShell(),
    cache.addAll(APP_SHELL_URLS.filter((url) => url !== "/" && url !== "/index.html")),
  ]);
}

async function fetchAndCacheAppShell() {
  const response = await fetch("/", { cache: "no-cache" });

  if (isCacheableResponse(response)) {
    const cache = await caches.open(UI_CACHE);
    await Promise.all([
      cache.put("/", response.clone()),
      cache.put("/index.html", response.clone()),
      precacheBuildAssets(response.clone()),
    ]);
  }

  return response;
}

async function precacheBuildAssets(shellResponse) {
  const contentType = shellResponse.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return;

  const html = await shellResponse.text();
  const assetUrls = [
    ...getPrecacheUrlsFromHtml(html),
    ...getPrecacheUrlsFromText(html, self.location.href),
  ];
  await precacheUrls(assetUrls);
}

async function precacheUrls(initialUrls) {
  const queue = [...initialUrls];
  const visited = new Set();
  const cache = await caches.open(ASSET_CACHE);

  while (queue.length > 0 && visited.size < 300) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;

    visited.add(url);

    try {
      const response = await fetch(url, { cache: "reload" });

      if (!isCacheableResponse(response)) {
        continue;
      }

      const cacheResponse = response.clone();
      const importResponse = response.clone();
      await cache.put(url, cacheResponse);

      if (shouldScanForImports(response)) {
        const text = await importResponse.text();
        for (const importUrl of getPrecacheUrlsFromText(text, url)) {
          if (!visited.has(importUrl)) {
            queue.push(importUrl);
          }
        }
      }
    } catch {
      // A failed warm cache should not block service worker installation.
    }
  }
}

function getPrecacheUrlsFromHtml(html) {
  const urls = new Set();
  const attributePattern = /\b(?:href|src)=["']([^"']+)["']/g;

  for (const [, value] of html.matchAll(attributePattern)) {
    const url = getPrecacheUrl(value, self.location.href);

    if (url) {
      urls.add(url);
    }
  }

  return [...urls];
}

function getPrecacheUrlsFromText(text, baseUrl) {
  const urls = new Set();
  const importPattern =
    /\b(?:import|export)\s+(?:[^'"]*?\s+from\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

  for (const [, staticImport, dynamicImport] of text.matchAll(importPattern)) {
    const url = getPrecacheUrl(staticImport ?? dynamicImport, baseUrl);

    if (url) {
      urls.add(url);
    }
  }

  return [...urls];
}

function getPrecacheUrl(value, baseUrl) {
  try {
    const base = new URL(baseUrl, self.location.origin);
    const url = new URL(value, base);
    return isPrecacheUrl(url) ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

function isPrecacheUrl(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/assets/") ||
      SAME_ORIGIN_STATIC_PATHS.has(url.pathname) ||
      isViteDevAssetRequest(new Request(url), url))
  );
}

function shouldScanForImports(response) {
  const contentType = response.headers.get("content-type") ?? "";
  return (
    contentType.includes("javascript") ||
    contentType.includes("typescript") ||
    contentType.includes("jsx") ||
    contentType.includes("tsx")
  );
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) return cached;

  const response = await fetch(request);

  if (isCacheableResponse(response)) {
    await cache.put(request, response.clone());
  }

  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);

    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone());
    }

    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error(`Cached response is unavailable for ${request.url}`);
  }
}

async function staleWhileRevalidate(event, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  const networkResponse = fetch(event.request).then((response) => {
    if (isCacheableResponse(response)) {
      cache.put(event.request, response.clone());
    }
    return response;
  });

  if (cached) {
    event.waitUntil(networkResponse.catch(() => undefined));
    return cached;
  }

  return networkResponse;
}

function isCacheableResponse(response) {
  return response.ok || response.type === "opaque";
}
