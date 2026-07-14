/**
 * Shared vocabulary for every schedule provider. Each provider fetches its own
 * feed but MUST normalize into the same game record, keyed by the same
 * canonical key, so the differ never sees a provider dialect.
 */

/** Provider abbr -> canonical abbr. */
const ABBR_ALIAS = {
  LA: 'LAR',
  SD: 'LAC',
  OAK: 'LV',
  STL: 'LAR',
  WSH: 'WAS',
};

export function canonicalAbbr(abbr) {
  if (!abbr) return '?';
  const upper = String(abbr).toUpperCase();
  return ABBR_ALIAS[upper] ?? upper;
}

/** Canonical abbr -> display name, for providers whose feed carries only abbrs. */
export const TEAM_NAMES = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs',
  LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', LV: 'Las Vegas Raiders', MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
  NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SEA: 'Seattle Seahawks',
  SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WAS: 'Washington Commanders',
};

export function teamFromAbbr(abbr) {
  const canonical = canonicalAbbr(abbr);
  return { abbr: canonical, name: TEAM_NAMES[canonical] ?? canonical };
}

const SEASON_TYPES = {
  1: 'Preseason',
  2: 'Regular Season',
  3: 'Postseason',
};

const POSTSEASON_WEEK_NAMES = {
  1: 'Wild Card',
  2: 'Divisional',
  3: 'Conference Championship',
  4: 'Pro Bowl',
  5: 'Super Bowl',
};

/** The (seasonType, week) slate the bot watches. */
export function weekSlots({ includePreseason = false } = {}) {
  const slots = [];
  if (includePreseason) {
    for (let w = 1; w <= 4; w++) slots.push({ seasonType: 1, week: w });
  }
  for (let w = 1; w <= 18; w++) slots.push({ seasonType: 2, week: w });
  for (let w = 1; w <= 5; w++) {
    if (w === 4) continue; // Pro Bowl — nobody's pickem cares
    slots.push({ seasonType: 3, week: w });
  }
  return slots;
}

export function weekLabel(seasonType, week) {
  if (seasonType === 3) return POSTSEASON_WEEK_NAMES[week] ?? `Postseason Week ${week}`;
  if (seasonType === 1) return `Preseason Week ${week}`;
  return `Week ${week}`;
}

export function seasonTypeLabel(seasonType) {
  return SEASON_TYPES[seasonType] ?? `Season type ${seasonType}`;
}

/**
 * The cross-provider identity of a game. Provider event ids differ (ESPN's
 * "401671789" vs nflverse's "2025_01_DAL_PHI"), so identity is the slot plus
 * the matchup. A game that moves WEEKS therefore posts as removed+added rather
 * than modified — acceptable: the group still gets told, loudly.
 */
export function gameKey({ seasonType, week, home, away }) {
  return `${seasonType}:${week}:${away?.abbr ?? '?'}@${home?.abbr ?? '?'}`;
}

/**
 * Build one canonical game record. Every provider funnels through this so a
 * missing field is null everywhere, never undefined-vs-''-vs-null by dialect.
 *
 * kickoff is a UTC ISO string or null. timeTBD means the DAY is known but the
 * league hasn't set the time yet (late-season flex windows) — providers fill
 * placeholder times there, and they disagree, so the differ needs the flag.
 * statusName uses ESPN's STATUS_* vocabulary; other dialects translate into it.
 */
export function makeGame({ ref, provider, seasonType, week, kickoff, home, away, venue = null, network = null, statusName = 'STATUS_SCHEDULED', timeTBD = false }) {
  const game = {
    ref: String(ref ?? ''),
    provider,
    seasonType,
    week,
    kickoff: kickoff ? new Date(kickoff).toISOString() : null,
    timeTBD: Boolean(timeTBD),
    home,
    away,
    venue,
    network,
    statusName,
  };
  game.key = gameKey(game);
  return game;
}

export async function fetchWithRetry(url, { timeoutMs = 15000, retries = 2, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'gridwire/0.1 (Ghostwire Systems NFL schedule watcher)', ...headers },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error(`fetch failed after ${retries + 1} attempts: ${url} — ${lastErr?.message ?? lastErr}`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
