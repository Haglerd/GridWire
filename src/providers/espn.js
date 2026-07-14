/**
 * ESPN site.api scoreboard — the primary rung.
 *
 * Two rules inherited from production incidents, both load-bearing:
 *
 *   1. ALWAYS pin the season with an explicit `dates={year}` param. A bare
 *      `?seasontype=&week=` lets ESPN answer with the most recent published
 *      season instead of the one you meant.
 *   2. REFUSE any payload that declares a different season/week than the one
 *      requested. A host that answers a question you didn't ask is a failed
 *      host, not data.
 */

import { canonicalAbbr, fetchWithRetry, makeGame, sleep, weekSlots } from './common.js';

const HOST = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

export const name = 'espn';

export function available() {
  return true; // public, no key
}

function toGame(event, seasonType, week) {
  const comp = event.competitions?.[0] ?? {};
  let home = null;
  let away = null;
  for (const c of comp.competitors ?? []) {
    const team = {
      abbr: canonicalAbbr(c.team?.abbreviation),
      name: c.team?.displayName ?? c.team?.shortDisplayName ?? '?',
    };
    if (c.homeAway === 'home') home = team;
    else away = team;
  }

  return makeGame({
    ref: event.id,
    provider: name,
    seasonType,
    week,
    kickoff: comp.date ?? event.date ?? null,
    // ESPN sets timeValid:false (and a midnight-ET placeholder time) on games
    // whose flex-window kickoff the league hasn't announced yet.
    timeTBD: comp.timeValid === false,
    home,
    away,
    venue: comp.venue?.fullName ?? null,
    network: comp.broadcasts?.[0]?.names?.[0] ?? comp.broadcast ?? null,
    statusName: comp.status?.type?.name ?? event.status?.type?.name ?? 'STATUS_SCHEDULED',
  });
}

async function fetchScoreboard(seasonYear, seasonType, week) {
  const url = `${HOST}?dates=${seasonYear}&seasontype=${seasonType}&week=${week}`;

  let json;
  try {
    const res = await fetchWithRetry(url);
    json = await res.json();
  } catch (err) {
    console.error(`[espn] ${err.message}`);
    return null;
  }

  // The refusal guard. ESPN omits week metadata on genuinely empty offseason
  // slates, so only enforce declared values.
  const servedYear = json?.season?.year;
  const servedType = json?.season?.type;
  const servedWeek = json?.week?.number;
  if (
    (servedYear != null && Number(servedYear) !== seasonYear) ||
    (servedType != null && Number(servedType) !== seasonType) ||
    (servedWeek != null && Number(servedWeek) !== week && (json?.events?.length ?? 0) > 0)
  ) {
    console.error(
      `[espn] refused payload: asked ${seasonYear}/${seasonType}/wk${week}, served ${servedYear}/${servedType}/wk${servedWeek}`
    );
    return null;
  }

  return json;
}

async function fetchWeek(seasonYear, seasonType, week) {
  const json = await fetchScoreboard(seasonYear, seasonType, week);
  if (!json) return { games: [], served: false };

  const games = (json.events ?? [])
    .filter((e) => e && typeof e === 'object' && e.id != null)
    .map((e) => toGame(e, seasonType, week));

  return { games, served: true };
}

/**
 * One week's slate with live scores — for the interactive commands, not the
 * schedule differ. Score fields deliberately never enter the snapshot: they
 * change all game long and would turn every game day into snapshot churn.
 */
export async function fetchWeekScores(seasonYear, seasonType, week) {
  const json = await fetchScoreboard(seasonYear, seasonType, week);
  if (!json) return { games: [], served: false };

  const games = (json.events ?? [])
    .filter((e) => e && typeof e === 'object' && e.id != null)
    .map((event) => {
      const comp = event.competitions?.[0] ?? {};
      const game = toGame(event, seasonType, week);
      for (const c of comp.competitors ?? []) {
        const score = c.score != null && c.score !== '' ? Number(c.score) : null;
        if (c.homeAway === 'home') game.homeScore = score;
        else game.awayScore = score;
      }
      const status = comp.status ?? event.status ?? {};
      game.statusDetail = status.type?.shortDetail ?? null; // "Final", "13:24 - 2nd", "Sun 1:00 PM"
      game.completed = Boolean(status.type?.completed);
      return game;
    });

  return { games, served: true };
}

/**
 * Fetch the whole season slate.
 *   games       — map of gameKey -> game for every week that answered
 *   servedSlots — "seasonType:week" keys that answered validly; the differ must
 *                 not treat a game as REMOVED if its week never answered.
 */
export async function fetchSeason(seasonYear, { includePreseason = false } = {}) {
  const games = {};
  const servedSlots = new Set();

  for (const { seasonType, week } of weekSlots({ includePreseason })) {
    const { games: weekGames, served } = await fetchWeek(seasonYear, seasonType, week);
    if (served) servedSlots.add(`${seasonType}:${week}`);
    for (const g of weekGames) games[g.key] = g;
    await sleep(250); // be a polite guest on an unofficial API
  }

  return { games, servedSlots };
}
