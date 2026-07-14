/**
 * balldontlie NFL v1 — the keyed third rung. One call per week:
 * GET /nfl/v1/games?seasons[]=Y&weeks[]=W with an Authorization header.
 * Only rungs in when BALLDONTLIE_API_KEY is configured.
 */

import { fetchWithRetry, makeGame, sleep, teamFromAbbr, weekSlots } from './common.js';

const BASE_URL = 'https://api.balldontlie.io/nfl/v1';

export const name = 'balldontlie';

export function available() {
  return Boolean(process.env.BALLDONTLIE_API_KEY);
}

function mapStatus(status, postponed) {
  if (postponed) return 'STATUS_POSTPONED';
  const s = String(status ?? '').toLowerCase();
  if (s.includes('cancel')) return 'STATUS_CANCELED';
  if (s.includes('postpon')) return 'STATUS_POSTPONED';
  if (s.includes('final')) return 'STATUS_FINAL';
  return 'STATUS_SCHEDULED';
}

/**
 * balldontlie's `week` counts postseason continuously after week 18
 * (19=WC, 20=DIV, 21=CONF, 22=SB). Regular season passes through.
 */
function requestWeek(seasonType, week) {
  if (seasonType === 2) return week;
  if (seasonType === 3) return 18 + (week === 5 ? 4 : week);
  return null; // no preseason coverage
}

async function fetchWeek(seasonYear, seasonType, week) {
  const bdlWeek = requestWeek(seasonType, week);
  if (bdlWeek === null) return { games: [], served: false };

  const url = `${BASE_URL}/games?seasons[]=${seasonYear}&weeks[]=${bdlWeek}&per_page=100`;

  let json;
  try {
    const res = await fetchWithRetry(url, {
      headers: { Authorization: process.env.BALLDONTLIE_API_KEY, Accept: 'application/json' },
    });
    json = await res.json();
  } catch (err) {
    console.error(`[balldontlie] ${err.message}`);
    return { games: [], served: false };
  }

  const rows = Array.isArray(json?.data) ? json.data : null;
  if (!rows) {
    console.error('[balldontlie] response had no data array');
    return { games: [], served: false };
  }

  const games = rows
    .filter((g) => g && g.home_team && g.visitor_team)
    .map((g) =>
      makeGame({
        ref: g.id,
        provider: name,
        seasonType,
        week,
        kickoff: g.date ?? null,
        home: teamFromAbbr(g.home_team.abbreviation),
        away: teamFromAbbr(g.visitor_team.abbreviation),
        venue: g.venue ?? null,
        statusName: mapStatus(g.status, g.postponed),
      })
    );

  return { games, served: true };
}

export async function fetchSeason(seasonYear, { includePreseason = false } = {}) {
  const games = {};
  const servedSlots = new Set();

  for (const { seasonType, week } of weekSlots({ includePreseason: false })) {
    const { games: weekGames, served } = await fetchWeek(seasonYear, seasonType, week);
    if (served) servedSlots.add(`${seasonType}:${week}`);
    for (const g of weekGames) games[g.key] = g;
    await sleep(1100); // free tier is rate-limited hard; don't trip it
  }

  return { games, servedSlots };
}
