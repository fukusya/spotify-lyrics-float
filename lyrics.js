// Fetches lyrics from LRCLIB (free, no API key) and parses LRC-timed lyrics.
// https://lrclib.net/docs

const LRCLIB_CLIENT_HEADER =
  "SpotifyLyricsFloat/1.0.0 (personal Chrome extension)";

async function fetchLyrics({ track, artist, album, durationSec }) {
  const params = new URLSearchParams({
    track_name: track,
    artist_name: artist,
  });
  if (album) params.set("album_name", album);
  if (durationSec) params.set("duration", Math.round(durationSec));

  const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
    headers: { "Lrclib-Client": LRCLIB_CLIENT_HEADER },
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB error ${res.status}`);
  return res.json();
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
