/**
 * The provider ladder: try each provider in order,
 * take the first one that actually serves the season. This is redundancy
 * against a provider outage, not a merge — one poll's snapshot always comes
 * from ONE provider, so the differ never compares dialects it shouldn't.
 */

import * as espn from './espn.js';
import * as nflverse from './nflverse.js';
import * as balldontlie from './balldontlie.js';

const REGISTRY = { espn, nflverse, balldontlie };
const DEFAULT_LADDER = ['espn', 'nflverse', 'balldontlie'];

export function ladder(orderCsv) {
  const order = (orderCsv ? orderCsv.split(',').map((s) => s.trim()) : DEFAULT_LADDER)
    .filter((n) => REGISTRY[n])
    .map((n) => REGISTRY[n])
    .filter((p) => p.available());
  return order;
}

/**
 * Fetch the season through the ladder. Returns the first provider result that
 * served at least one slot, tagged with the provider that produced it.
 */
export async function fetchSeason(seasonYear, { includePreseason = false, providerOrder = null } = {}) {
  const rungs = ladder(providerOrder);

  for (const provider of rungs) {
    const { games, servedSlots } = await provider.fetchSeason(seasonYear, { includePreseason });
    if (servedSlots.size > 0) {
      return { games, servedSlots, provider: provider.name };
    }
    console.error(`[ladder] ${provider.name} served nothing — failing over`);
  }

  return { games: {}, servedSlots: new Set(), provider: null };
}
