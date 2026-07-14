import 'dotenv/config';
import { fileURLToPath } from 'node:url';

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] Missing required env var ${name} — copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
}

/**
 * The season to watch when SEASON_YEAR isn't pinned.
 *
 * Jan–Feb: last calendar year's season (playoffs still running).
 * Mar onward: this calendar year's season — the schedule releases in May,
 * and watching for that release is half this bot's job.
 */
export function defaultSeasonYear(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return month <= 2 ? year - 1 : year;
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  channelId: required('DISCORD_CHANNEL_ID'),
  seasonYear: process.env.SEASON_YEAR ? Number(process.env.SEASON_YEAR) : defaultSeasonYear(),
  pollMinutes: process.env.POLL_MINUTES ? Number(process.env.POLL_MINUTES) : 30,
  includePreseason: process.env.INCLUDE_PRESEASON === '1',
  // "espn,nflverse,balldontlie" — reorder or drop rungs without touching code.
  providerOrder: process.env.PROVIDER_ORDER || null,
  // @everyone on change alerts. On by default — the whole point is the group sees it.
  mentionEveryone: process.env.MENTION_EVERYONE !== '0',
  dataDir: process.env.DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)),
};
