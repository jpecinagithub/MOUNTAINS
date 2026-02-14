// Details page logic (best-effort enrichment).
// Data comes from query params and/or sessionStorage set by script.js.

function qs(id) {
  return document.getElementById(id);
}

function toTitleCase(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ");
}

function formatElevation(ele) {
  if (ele === null || ele === undefined || ele === "") return "No disponible";
  const n = Number(ele);
  if (!Number.isFinite(n)) return "No disponible";
  return `${n.toLocaleString()} m`;
}

function formatElevationCompact(ele) {
  if (ele === null || ele === undefined || ele === "") return "-";
  const n = Number(ele);
  if (!Number.isFinite(n)) return "-";
  return `${n.toLocaleString()}m`;
}

function formatCoords(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "No disponible";
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

function parseWikipediaTag(tag) {
  // OSM wikipedia tag is typically like "es:Monte_Aneto" or "en:Aneto".
  if (!tag || typeof tag !== "string") return null;
  const idx = tag.indexOf(":");
  if (idx <= 0) return null;
  const lang = tag.slice(0, idx).trim();
  const title = tag.slice(idx + 1).trim();
  if (!lang || !title) return null;
  return { lang, title };
}

async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=10&addressdetails=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("reverse geocode failed");
  const data = await res.json();
  const a = data.address || {};
  const parts = [];
  if (a.city) parts.push(a.city);
  else if (a.town) parts.push(a.town);
  else if (a.village) parts.push(a.village);
  else if (a.county) parts.push(a.county);
  if (a.state) parts.push(a.state);
  if (a.country) parts.push(a.country);
  return parts.join(", ") || data.display_name || "No disponible";
}

async function wikipediaSummaryByTitle(lang, title) {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("wikipedia summary failed");
  return res.json();
}

async function wikipediaSummaryBySearch(query) {
  const searchUrl = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
  const res = await fetch(searchUrl);
  if (!res.ok) throw new Error("wikipedia search failed");
  const data = await res.json();
  const hit = data?.query?.search?.[0];
  if (!hit?.title) throw new Error("no wikipedia hits");
  return wikipediaSummaryByTitle("es", hit.title.replace(/ /g, "_"));
}

function setText(id, value) {
  const el = qs(id);
  if (!el) return;
  el.textContent = value;
}

function setHtml(id, value) {
  const el = qs(id);
  if (!el) return;
  el.innerHTML = value;
}

function setImg(id, src, alt) {
  const el = qs(id);
  if (!el) return;
  el.src = src;
  if (alt) el.alt = alt;
}

function safeUrl(u) {
  try {
    return new URL(u, window.location.href).toString();
  } catch {
    return null;
  }
}

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return n;
  return Math.min(max, Math.max(min, n));
}

function buildWikilocMapUrl({ q, act, lat, lon, spanDeg = 0.25, page = 1 }) {
  const base = "https://es.wikiloc.com/wikiloc/map.do";
  const params = new URLSearchParams();

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const swLat = clamp(lat - spanDeg, -89.999, 89.999);
    const swLon = clamp(lon - spanDeg, -179.999, 179.999);
    const neLat = clamp(lat + spanDeg, -89.999, 89.999);
    const neLon = clamp(lon + spanDeg, -179.999, 179.999);
    params.set("sw", `${swLat.toFixed(6)},${swLon.toFixed(6)}`);
    params.set("ne", `${neLat.toFixed(6)},${neLon.toFixed(6)}`);
  }

  if (act) params.set("act", String(act));
  if (q) params.set("q", q);
  params.set("fitMapToTrails", "1");
  params.set("page", String(page));

  return `${base}?${params.toString()}`;
}

function getGoogleMapsKey() {
  const k = (typeof window !== "undefined" && window.GOOGLE_MAPS_API_KEY) ? String(window.GOOGLE_MAPS_API_KEY).trim() : "";
  return k || "";
}

function loadGoogleMapsJsApi(key) {
  if (!key) return Promise.reject(new Error("missing key"));
  if (window.google && window.google.maps) return Promise.resolve();

  if (window.__googleMapsJsLoading) return window.__googleMapsJsLoading;

  window.__googleMapsJsLoading = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-maps-js="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("google maps js load failed")));
      return;
    }

    const s = document.createElement("script");
    s.dataset.googleMapsJs = "1";
    s.async = true;
    s.defer = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("google maps js load failed"));
    document.head.appendChild(s);
  });

  return window.__googleMapsJsLoading;
}

function buildStreetViewMetadataUrl({ lat, lon, key, source, radius = 200 }) {
  const u = new URL("https://maps.googleapis.com/maps/api/streetview/metadata");
  u.searchParams.set("location", `${lat},${lon}`);
  u.searchParams.set("radius", String(radius));
  if (source) u.searchParams.set("source", source);
  u.searchParams.set("key", key);
  return u.toString();
}

function buildStreetViewStaticUrl({ lat, lon, key, pano, heading = 0, pitch = 0, fov = 90, size = "640x420", source = "outdoor" }) {
  const u = new URL("https://maps.googleapis.com/maps/api/streetview");
  if (pano) u.searchParams.set("pano", pano);
  else u.searchParams.set("location", `${lat},${lon}`);
  u.searchParams.set("size", size);
  u.searchParams.set("fov", String(fov));
  u.searchParams.set("heading", String(heading));
  u.searchParams.set("pitch", String(pitch));
  u.searchParams.set("source", source);
  // If no pano is available, this makes errors explicit (instead of a generic image).
  u.searchParams.set("return_error_code", "true");
  u.searchParams.set("key", key);
  return u.toString();
}

async function tryHydrateGoogleImages(mountain) {
  const key = getGoogleMapsKey();
  if (!key) {
    const strip = qs("streetView360");
    if (strip) strip.innerHTML = "";
    setText("streetViewHint", "Configura tu Google API key en `config.js` (window.GOOGLE_MAPS_API_KEY) para activar Street View y el mapa estatico.");
    return { used: false };
  }

  const lat = Number(mountain?.lat);
  const lon = Number(mountain?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    setText("streetViewHint", "Coordenadas no disponibles para pedir Street View.");
    return { used: false };
  }

  // 1) Check Street View availability
  let meta = null;
  try {
    // Mountains often have sparse coverage. Try outdoor first, then default, with a generous radius.
    const metaUrls = [
      buildStreetViewMetadataUrl({ lat, lon, key, source: "outdoor", radius: 2000 }),
      buildStreetViewMetadataUrl({ lat, lon, key, source: "default", radius: 2000 }),
      buildStreetViewMetadataUrl({ lat, lon, key, source: undefined, radius: 2000 })
    ];

    for (const metaUrl of metaUrls) {
      const res = await fetch(metaUrl, { headers: { "Accept": "application/json" } });
      if (!res.ok) continue;
      const data = await res.json();
      meta = data;
      if (data && data.status === "OK") break;
    }
  } catch {
    meta = null;
  }

  const hasStreetView = meta && meta.status === "OK";
  const pano = hasStreetView ? meta.pano_id : null;
  const svLat = hasStreetView && meta.location ? Number(meta.location.lat) : lat;
  const svLon = hasStreetView && meta.location ? Number(meta.location.lng) : lon;

  // Street View hero + 360 strip (only if available)
  if (!hasStreetView) {
    const status = meta?.status ? String(meta.status) : "ERROR";
    const msg = meta?.error_message ? ` (${String(meta.error_message)})` : "";
    setText(
      "streetViewHint",
      `Street View no disponible para estas coordenadas. Estado: ${status}${msg}. Esto es normal en picos remotos.`
    );
    return { used: true, streetView: false };
  }

  const headings = [0, 90, 180, 270];
  const heroUrl = buildStreetViewStaticUrl({ lat: svLat, lon: svLon, key, pano, heading: 0, pitch: 0, fov: 90, size: "640x640" });
  setImg("heroImg", heroUrl, `Street View: ${mountain.name}`);
  setText("streetViewHint", "Street View cargado. Puedes arrastrar el visor 360 o pulsar miniaturas.");

  // Try to render an interactive panorama (true 360) using Google Maps JS API.
  const panoEl = qs("streetViewPanorama");
  if (panoEl) {
    try {
      await loadGoogleMapsJsApi(key);
      panoEl.classList.remove("hidden");
      // eslint-disable-next-line no-undef
      const panorama = new google.maps.StreetViewPanorama(panoEl, {
        pano,
        pov: { heading: 0, pitch: 0 },
        zoom: 0,
        addressControl: false,
        fullscreenControl: true,
        linksControl: true,
        motionTracking: false,
        panControl: false,
        zoomControl: true,
        showRoadLabels: false,
        disableDefaultUI: true
      });
      // Keep a reference in case we want to reuse later.
      window.__streetViewPanorama = panorama;
    } catch (e) {
      // If Maps JS API isn't enabled, we keep the static thumbnails only.
      panoEl.classList.add("hidden");
    }
  }

  const strip = qs("streetView360");
  if (strip) {
    strip.innerHTML = "";
    headings.forEach((h) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "flex-shrink-0 w-24 h-16 rounded-lg overflow-hidden border border-slate-200 dark:border-white/10";
      btn.title = `Heading ${h}`;

      const img = document.createElement("img");
      img.src = buildStreetViewStaticUrl({ lat: svLat, lon: svLon, key, pano, heading: h, pitch: 0, fov: 90, size: "240x160" });
      img.alt = `Vista ${h} grados`;
      img.className = "w-full h-full object-cover";
      img.loading = "lazy";

      btn.appendChild(img);
      btn.addEventListener("click", () => {
        if (window.__streetViewPanorama && typeof window.__streetViewPanorama.setPov === "function") {
          window.__streetViewPanorama.setPov({ heading: h, pitch: 0 });
        }
        setImg("heroImg", buildStreetViewStaticUrl({ lat: svLat, lon: svLon, key, pano, heading: h, pitch: 0, fov: 90, size: "640x640" }), `Street View: ${mountain.name}`);
      });
      strip.appendChild(btn);
    });
  }

  return { used: true, streetView: true };
}

function renderWikilocRoutes(mountain, placeLabel) {
  const root = qs("wikilocRoutes");
  if (!root) return;

  const q = [mountain?.name, placeLabel].filter(Boolean).join(" ");
  const lat = Number(mountain?.lat);
  const lon = Number(mountain?.lon);

  // Activity ids come from Wikiloc's own map search.
  const items = [
    { act: 1, label: "Senderismo", icon: "filter_hdr" },
    { act: 14, label: "Alpinismo", icon: "terrain" },
    { act: 48, label: "Trail running", icon: "directions_run" },
    { act: 2, label: "MTB", icon: "pedal_bike" },
    { act: 43, label: "Paseo", icon: "hiking" }
  ];

  root.innerHTML = "";
  items.forEach((it, idx) => {
    const a = document.createElement("a");
    a.href = buildWikilocMapUrl({ q, act: it.act, lat, lon, page: 1 });
    a.target = "_blank";
    a.rel = "noreferrer";
    a.className = "flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-background-dark/30 px-4 py-3 hover:bg-white/80 dark:hover:bg-background-dark/40 transition-colors";
    a.innerHTML = `
      <span class="flex items-center gap-3">
        <span class="material-symbols-outlined text-primary">${it.icon}</span>
        <span class="text-sm font-bold text-slate-900 dark:text-white">Ruta ${idx + 1}: ${it.label}</span>
      </span>
      <span class="material-symbols-outlined text-slate-400">open_in_new</span>
    `;
    root.appendChild(a);
  });
}

function buildShareUrl(mountain) {
  const p = new URLSearchParams();
  if (mountain.id) p.set("id", String(mountain.id));
  if (mountain.name) p.set("name", mountain.name);
  if (Number.isFinite(mountain.lat)) p.set("lat", String(mountain.lat));
  if (Number.isFinite(mountain.lon)) p.set("lon", String(mountain.lon));
  if (mountain.elevation != null) p.set("ele", String(mountain.elevation));
  if (mountain.type) p.set("type", mountain.type);
  return `${window.location.origin}${window.location.pathname}?${p.toString()}`;
}

function getMountainFromUrlOrStorage() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  let mountain = null;
  if (id) {
    const raw = sessionStorage.getItem(`mountain:${id}`);
    if (raw) {
      try {
        mountain = JSON.parse(raw);
      } catch {
        mountain = null;
      }
    }
  }

  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const eleRaw = params.get("ele");
  const elevation = eleRaw === null || eleRaw === "" ? null : Number(eleRaw);

  mountain = {
    ...(mountain || {}),
    id: id ? Number(id) : mountain?.id,
    name: toTitleCase(params.get("name") || mountain?.name || "Montaña"),
    lat: Number.isFinite(lat) ? lat : Number(mountain?.lat),
    lon: Number.isFinite(lon) ? lon : Number(mountain?.lon),
    elevation: Number.isFinite(elevation) ? elevation : (mountain?.elevation ?? null),
    type: params.get("type") || mountain?.type || "peak",
    wikipedia: mountain?.wikipedia || null
  };

  return mountain;
}

async function hydratePage() {
  const mountain = getMountainFromUrlOrStorage();

  setText("mountainName", mountain.name);
  setText("statAltitude", formatElevationCompact(mountain.elevation));

  const coordsStr = formatCoords(mountain.lat, mountain.lon);
  setText("statCoords", coordsStr);

  const osmUrl = (Number.isFinite(mountain.lat) && Number.isFinite(mountain.lon))
    ? `https://www.openstreetmap.org/?mlat=${encodeURIComponent(mountain.lat)}&mlon=${encodeURIComponent(mountain.lon)}#map=14/${encodeURIComponent(mountain.lat)}/${encodeURIComponent(mountain.lon)}`
    : "index.html";
  qs("openInOSM").href = osmUrl;

  qs("backBtn").addEventListener("click", () => {
    // Prefer browser history if available.
    if (window.history.length > 1) window.history.back();
    else window.location.href = "index.html";
  });

  qs("copyCoords").addEventListener("click", async () => {
    const text = (Number.isFinite(mountain.lat) && Number.isFinite(mountain.lon))
      ? `${mountain.lat.toFixed(6)}, ${mountain.lon.toFixed(6)}`
      : "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      qs("copyCoords").blur();
    } catch {
      // ignore
    }
  });

  qs("shareBtn").addEventListener("click", async () => {
    const url = buildShareUrl(mountain);
    const title = `Montaña: ${mountain.name}`;
    const text = `Altitud: ${formatElevation(mountain.elevation)} | Coordenadas: ${coordsStr}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        return;
      }
    } catch {
      // fall back to clipboard
    }
    try {
      await navigator.clipboard.writeText(url);
      setText("historySource", "Enlace copiado al portapapeles.");
    } catch {
      // ignore
    }
  });

  // Location string
  let placeLabel = "";
  try {
    if (Number.isFinite(mountain.lat) && Number.isFinite(mountain.lon)) {
      placeLabel = await reverseGeocode(mountain.lat, mountain.lon);
      setText("locationTag", placeLabel);
      setText("statPlace", placeLabel);
    } else {
      setText("locationTag", "Ubicación no disponible");
      setText("statPlace", "-");
    }
  } catch {
    setText("locationTag", "Ubicación no disponible");
    setText("statPlace", "-");
  }

  renderWikilocRoutes(mountain, placeLabel);

  // Google images (Street View + Static Map) if API key is configured.
  // Falls back to Wikipedia/Unsplash if not available.
  const googleRes = await tryHydrateGoogleImages(mountain);

  // History + image (Wikipedia best-effort).
  let summary = null;
  try {
    const wp = parseWikipediaTag(mountain.wikipedia);
    if (wp) summary = await wikipediaSummaryByTitle(wp.lang, wp.title);
    else summary = await wikipediaSummaryBySearch(mountain.name);
  } catch {
    summary = null;
  }

  if (summary?.extract) {
    setText("historyText", summary.extract);
    if (summary?.content_urls?.desktop?.page) {
      const pageUrl = safeUrl(summary.content_urls.desktop.page);
      if (pageUrl) {
        setHtml("historySource", `Fuente: <a class="underline hover:text-primary" href="${pageUrl}" target="_blank" rel="noreferrer">Wikipedia</a>`);
      }
    }
    const thumb = summary?.thumbnail?.source;
    if (thumb && !googleRes?.streetView) {
      setImg("heroImg", thumb, `Imagen de ${mountain.name}`);
    }
  } else {
    setText("historyText", "Historia no disponible automaticamente. Si esta montana tiene pagina en Wikipedia, puedes anadir el tag OSM 'wikipedia' para mejorar esta seccion.");
    // Last-resort image that usually works without keys.
    const fallback = `https://source.unsplash.com/featured/1200x800/?mountain,peak,${encodeURIComponent(mountain.name)}`;
    if (!googleRes?.streetView) {
      setImg("heroImg", fallback, `Imagen de ${mountain.name}`);
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  hydratePage().catch(() => {
    setText("historyText", "No se pudo cargar la informacion detallada.");
  });
});
