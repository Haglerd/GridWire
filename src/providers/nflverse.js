/**
 * nflverse games.csv — the $0 fallback rung. A different company's data than
 * ESPN, which is what makes it real redundancy.
 *
 * One CSV covers every season. `gameday` (YYYY-MM-DD) + `gametime` (HH:MM) are
 * US/Eastern and must be converted to UTC. No preseason rows, no broadcast
 * network worth trusting, no live status — schedule identity + kickoff only.
 */

import { fetchWithRetry, makeGame, teamFromAbbr, weekSlots } from './common.js';

const FEED_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';

export const name = 'nflverse';

export function available() {
  return true; // public CSV, no key
}

/** game_type -> our (seasonType, week). Postseason weeks follow the ESPN slot numbering. */
function mapType(gameType, week) {
  switch (gameType) {
    case 'REG': return { seasonType: 2, week };
    case 'WC': return { seasonType: 3, week: 1 };
    case 'DIV': return { seasonType: 3, week: 2 };
    case 'CON': return { seasonType: 3, week: 3 };
    case 'SB': return { seasonType: 3, week: 5 };
    default: return null; // preseason / unknown — nflverse carries no such slate anyway
  }
}

/**
 * US/Eastern wall time -> UTC Date, via the offset that America/New_York
 * actually had at that instant (handles DST without a tz library). NFL games
 * don't kick off inside the 2am transition hour, so one adjustment pass is exact.
 */
export function easternToUtc(dateStr, timeStr) {
  const wall = `${dateStr}T${(timeStr && /^\d{1,2}:\d{2}/.test(timeStr)) ? timeStr.padStart(5, '0') : '00:00'}:00`;
  const guess = new Date(`${wall}Z`);
  if (Number.isNaN(guess.getTime())) return null;

  const nyParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(guess).reduce((acc, p) => ((acc[p.type] = p.value), acc), {});

  const nyAsUtc = Date.parse(
    `${nyParts.year}-${nyParts.month}-${nyParts.day}T${nyParts.hour === '24' ? '00' : nyParts.hour}:${nyParts.minute}:${nyParts.second}Z`
  );
  const offsetMs = nyAsUtc - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

/** Minimal RFC-4180 CSV parse — nflverse quotes fields that contain commas. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export async function fetchSeason(seasonYear, { includePreseason = false } = {}) {
  const games = {};
  const servedSlots = new Set();

  let text;
  try {
    const res = await fetchWithRetry(FEED_URL, { timeoutMs: 30000 });
    text = await res.text();
  } catch (err) {
    console.error(`[nflverse] ${err.message}`);
    return { games, servedSlots };
  }

  const rows = parseCsv(text);
  if (rows.length < 2) {
    console.error('[nflverse] CSV had no data rows');
    return { games, servedSlots };
  }

  const header = rows[0];
  const col = (name) => header.indexOf(name);
  const idx = {
    gameId: col('game_id'),
    season: col('season'),
    gameType: col('game_type'),
    week: col('week'),
    gameday: col('gameday'),
    gametime: col('gametime'),
    away: col('away_team'),
    home: col('home_team'),
    stadium: col('stadium'),
  };
  if (idx.gameId < 0 || idx.season < 0 || idx.gameType < 0 || idx.week < 0 || idx.home < 0 || idx.away < 0) {
    console.error('[nflverse] CSV schema changed — required columns missing');
    return { games, servedSlots };
  }

  let matched = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (Number(r[idx.season]) !== seasonYear) continue;

    const slot = mapType(r[idx.gameType], Number(r[idx.week]));
    if (!slot) continue;

    const gametime = idx.gametime >= 0 ? r[idx.gametime] : '';
    const kickoff = idx.gameday >= 0 && r[idx.gameday]
      ? easternToUtc(r[idx.gameday], gametime)
      : null;

    const game = makeGame({
      ref: r[idx.gameId],
      provider: name,
      seasonType: slot.seasonType,
      week: slot.week,
      kickoff,
      // Blank gametime = day known, time not announced. nflverse ALSO fills
      // projected times for unflexed late-season games with no way to tell,
      // which is why the differ suppresses kickoff diffs whenever EITHER side
      // of a cross-provider comparison is time-TBD.
      timeTBD: !gametime,
      home: teamFromAbbr(r[idx.home]),
      away: teamFromAbbr(r[idx.away]),
      venue: idx.stadium >= 0 ? (r[idx.stadium] || null) : null,
    });
    games[game.key] = game;
    matched++;
  }

  // The CSV is authoritative for the whole (non-preseason) season in one shot:
  // if it answered at all, every REG/POST slot was served.
  if (matched > 0) {
    for (const { seasonType, week } of weekSlots({ includePreseason: false })) {
      servedSlots.add(`${seasonType}:${week}`);
    }
  }

  return { games, servedSlots };
}
