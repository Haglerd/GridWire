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

  loadChangeLog(seasonYear) {
    try {
      return JSON.parse(readFileSync(join(this.dataDir, `changes-${seasonYear}.json`), 'utf8'));
    } catch {
      return { seasonYear, entries: [] };
    }
  }

  /**
   * Append alerted events so /changes can answer "what moved this week"
   * without replaying snapshots. Capped — it's an answer window, not an archive.
   */
  appendChangeLog(seasonYear, newEntries, cap = 400) {
    const log = this.loadChangeLog(seasonYear);
    log.entries = [...log.entries, ...newEntries].slice(-cap);
    const path = join(this.dataDir, `changes-${seasonYear}.json`);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(log, null, 2));
    renameSync(tmp, path);
  }
}
