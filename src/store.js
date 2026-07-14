/**
 * Flat-file persistence: data/snapshot-<year>.json — the last known schedule
 * (gameKey -> game) plus which provider served it.
 *
 * Deliberately not a database: a season is ~285 small records written every
 * poll by a single process. Revisit when the backlog features (per-guild SQL
 * templates, pick tracking, history) arrive.
 */

import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    mkdirSync(dataDir, { recursive: true });
  }

  loadSnapshot(seasonYear) {
    try {
      return JSON.parse(readFileSync(join(this.dataDir, `snapshot-${seasonYear}.json`), 'utf8'));
    } catch {
      return null;
    }
  }

  saveSnapshot(seasonYear, { games, provider }) {
    const path = join(this.dataDir, `snapshot-${seasonYear}.json`);
    const tmp = `${path}.tmp`;
    const doc = {
      seasonYear,
      provider,
      savedAt: new Date().toISOString(),
      games,
    };
    writeFileSync(tmp, JSON.stringify(doc, null, 2));
    renameSync(tmp, path); // never leave a half-written snapshot behind
  }
}
