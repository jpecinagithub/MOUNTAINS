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
  setText("infoName", mountain.name);
  setText("infoType", mountain.type === "volcano" ? "Volcán" : "Cima");
  setText("infoElevation", formatElevation(mountain.elevation));
  setText("statAltitude", formatElevationCompact(mountain.elevation));

  const coordsStr = formatCoords(mountain.lat, mountain.lon);
  setText("statCoords", coordsStr);
  setText("infoCoords", coordsStr);

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
  try {
    if (Number.isFinite(mountain.lat) && Number.isFinite(mountain.lon)) {
      const place = await reverseGeocode(mountain.lat, mountain.lon);
      setText("locationTag", place);
      setText("statPlace", place);
    } else {
      setText("locationTag", "Ubicación no disponible");
      setText("statPlace", "-");
    }
  } catch {
    setText("locationTag", "Ubicación no disponible");
    setText("statPlace", "-");
  }

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
    if (thumb) {
      setImg("heroImg", thumb, `Imagen de ${mountain.name}`);
    }
  } else {
    setText("historyText", "Historia no disponible automaticamente. Si esta montana tiene pagina en Wikipedia, puedes anadir el tag OSM 'wikipedia' para mejorar esta seccion.");
    // Last-resort image that usually works without keys.
    const fallback = `https://source.unsplash.com/featured/1200x800/?mountain,peak,${encodeURIComponent(mountain.name)}`;
    setImg("heroImg", fallback, `Imagen de ${mountain.name}`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  hydratePage().catch(() => {
    setText("historyText", "No se pudo cargar la informacion detallada.");
  });
});
