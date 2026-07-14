/**
 * Gridwire by Ghostwire Systems — NFL schedule watcher for Discord.
 *
 * Poll the provider ladder, diff against the last snapshot, post what changed.
 * Flags: --once (single poll, then exit) · --dry-run (no Discord, print to console)
 */

import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { Store } from './store.js';
import { fetchSeason } from './providers/index.js';
import { diffSchedules } from './diff.js';
import { releaseEmbed, changeEmbed, changeSummary, chunkEmbeds } from './format.js';

const ONCE = process.argv.includes('--once');
const DRY_RUN = process.argv.includes('--dry-run');

const store = new Store(config.dataDir);

async function poll(send) {
  const startedAt = new Date().toISOString();
  console.log(`[poll] ${startedAt} — season ${config.seasonYear}`);

  const { games, servedSlots, provider } = await fetchSeason(config.seasonYear, {
    includePreseason: config.includePreseason,
    providerOrder: config.providerOrder,
  });

  if (!provider) {
    console.error('[poll] every provider failed — keeping the old snapshot, trying again next tick');
    return;
  }

  console.log(`[poll] ${provider} served ${Object.keys(games).length} games across ${servedSlots.size} week slots`);

  const snapshot = store.loadSnapshot(config.seasonYear);

  if (!snapshot) {
    // First run: capture the baseline quietly. Alerting on 285 "new" games
    // that everyone already knows about would train the group to mute the bot.
    store.saveSnapshot(config.seasonYear, { games, provider });
    console.log('[poll] first run — baseline captured, no alerts');
    return;
  }

  const { release, changes } = diffSchedules(
    snapshot.games,
    games,
    servedSlots,
    snapshot.provider ?? null,
    provider
  );

  if (!release && changes.length === 0) {
    store.saveSnapshot(config.seasonYear, { games, provider });
    console.log('[poll] no changes');
    return;
  }

  const embeds = [];
  if (release) embeds.push(releaseEmbed(config.seasonYear, release));
  for (const change of changes) embeds.push(changeEmbed(config.seasonYear, change));

  console.log(`[poll] ${release ? 'SCHEDULE RELEASE + ' : ''}${changes.length} change(s) — posting`);

  const mention = config.mentionEveryone ? '@everyone ' : '';
  const headline = release
    ? `${mention}🏈 **The ${config.seasonYear} NFL schedule just dropped!**`
    : `${mention}📅 **NFL schedule change** — update your schedule!`;

  const batches = chunkEmbeds(embeds);
  for (let i = 0; i < batches.length; i++) {
    await send({
      content: i === 0 ? headline : undefined,
      embeds: batches[i],
      allowedMentions: { parse: config.mentionEveryone ? ['everyone'] : [] },
    });
  }

  // Save only after the alerts actually went out, so a Discord failure means
  // we re-alert next tick instead of silently swallowing the change.
  store.saveSnapshot(config.seasonYear, { games, provider });

  const at = new Date().toISOString();
  const entries = [];
  if (release) {
    entries.push({ at, type: 'release', summary: `🏈 **${config.seasonYear} schedule released** — ${release.newCount} games` });
  }
  for (const change of changes) entries.push({ at, type: change.type, summary: changeSummary(change) });
  store.appendChangeLog(config.seasonYear, entries);
}

async function main() {
  let send;
  let client = null;

  if (DRY_RUN) {
    send = async (message) => {
      console.log('--- DRY RUN message ---');
      if (message.content) console.log(message.content);
      for (const e of message.embeds ?? []) console.log(JSON.stringify(e.toJSON(), null, 2));
    };
  } else {
    client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await client.login(config.discordToken);
    // login() may resolve after ready has already fired — only wait if it hasn't.
    if (!client.isReady()) {
      await new Promise((resolve) => client.once('clientReady', resolve));
    }
    console.log(`[discord] logged in as ${client.user.tag}`);

    const channel = await client.channels.fetch(config.channelId);
    if (!channel?.isTextBased()) {
      console.error(`[discord] channel ${config.channelId} is not a text channel I can post to`);
      process.exit(1);
    }
    send = (message) => channel.send(message);
  }

  const runPoll = async () => {
    try {
      await poll(send);
    } catch (err) {
      console.error('[poll] crashed:', err);
    }
  };

  await runPoll();

  if (ONCE) {
    client?.destroy();
    return;
  }

  console.log(`[main] polling every ${config.pollMinutes} minutes`);
  setInterval(runPoll, config.pollMinutes * 60 * 1000);
}

main().catch((err) => {
  console.error('[main] fatal:', err);
  process.exit(1);
});
