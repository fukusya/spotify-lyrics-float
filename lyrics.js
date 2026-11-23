// Fetches lyrics from LRCLIB (free, no API key) and parses LRC-timed lyrics.
// https://lrclib.net/docs

const LRCLIB_CLIENT_HEADER =
  "SpotifyLyricsFloat/1.0.0 (personal Chrome extension)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One LRCLIB request with retry on rate-limit (429) / server errors.
// Returns parsed JSON, or null on 404. Throws if it keeps failing.
async function lrclibGet(path, params) {
  const url = `https://lrclib.net/api/${path}?${new URLSearchParams(params).toString()}`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "Lrclib-Client": LRCLIB_CLIENT_HEADER } });
      if (res.status === 404) return null;
      if (res.ok) return res.json();
      lastErr = new Error(`LRCLIB error ${res.status}`);
      if (res.status !== 429 && res.status < 500) throw lastErr;
      const retryAfter = parseInt(res.headers.get("retry-after") || "", 10);
      await sleep(Number.isFinite(retryAfter) ? Math.min(retryAfter, 10) * 1000 : 1500 * (attempt + 1));
    } catch (e) {
      lastErr = e;
      if (e.message && e.message.startsWith("LRCLIB error 4")) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

const hasLyrics = (d) => d && (d.syncedLyrics || d.plainLyrics || d.instrumental);

// Tries an exact match first, then looser matches, so small differences in
// album name / artist list / duration between Spotify and LRCLIB don't
// end up as "lyrics not found".
async function fetchLyrics({ track, artist, album, durationSec }) {
  const firstArtist = (artist || "").split(",")[0].trim();
  const duration = durationSec ? Math.round(durationSec) : null;

  const base = { track_name: track, artist_name: firstArtist };
  if (duration) base.duration = duration;

  // 1) Exact match with album, 2) without album.
  if (album) {
    const d = await lrclibGet("get", { ...base, album_name: album });
    if (hasLyrics(d)) return d;
  }
  const d2 = await lrclibGet("get", base);
  if (hasLyrics(d2)) return d2;

  // 3) Search by title + artist, pick the closest duration (prefer synced).
  const results = await lrclibGet("search", { track_name: track, artist_name: firstArtist });
  if (!Array.isArray(results) || results.length === 0) return null;
  const score = (r) =>
    (duration ? Math.abs((r.duration || 0) - duration) : 0) + (r.syncedLyrics ? 0 : 1000);
  const best = results.filter(hasLyrics).sort((a, b) => score(a) - score(b))[0];
  return best || null;
}

// Parses an LRC string ("[mm:ss.xx] line") into [{ time, text }], sorted.
function parseSyncedLyrics(lrcText) {
  const lines = [];
  const timeTag = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

  for (const rawLine of lrcText.split("\n")) {
    const tags = [...rawLine.matchAll(timeTag)];
    if (tags.length === 0) continue;
    const text = rawLine.replace(timeTag, "").trim();
    for (const tag of tags) {
      const minutes = parseInt(tag[1], 10);
      const seconds = parseInt(tag[2], 10);
      const fraction = tag[3] ? parseInt(tag[3].padEnd(3, "0"), 10) / 1000 : 0;
      lines.push({ time: minutes * 60 + seconds + fraction, text });
    }
  }

  lines.sort((a, b) => a.time - b.time);
  return lines;
}

// Returns the index of the line active at currentTime, or -1 if before the
// first line.
function findActiveLineIndex(lines, currentTime) {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= currentTime) idx = i;
    else break;
  }
  return idx;
}
