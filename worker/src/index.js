/**
 * Gridwire interactions worker — answers the slash commands over Discord's
 * HTTP interactions endpoint, so no always-on bot process is needed.
 *
 * Data sources, in keeping with the split architecture:
 *   - schedule commands read the snapshot/changelog the GitHub Actions poller
 *     commits to the public repo (raw.githubusercontent.com)
 *   - /score and /apis hit the providers live
 *
 * No bot token lives here: interaction responses use the per-interaction
 * webhook token Discord supplies in the payload. Channel ids arrive as
 * Worker secrets, never in code.
 */

import {
  currentSlot,
  defaultSeasonYear,
  resolveTeam,
  seasonTypeLabel,
  weekLabel,
} from '../../src/providers/common.js';
import * as espn from '../../src/providers/espn.js';

const REPO_RAW = 'https://raw.githubusercontent.com/Haglerd/GridWire/main';

const COLORS = {
  brand: 0x5865f2,
  final: 0x57f287,
  live: 0xed4245,
  warn: 0xfee75c,
  neutral: 0x99aab5,
};

const FOOTER = { text: 'Gridwire · Ghostwire Systems' };

// ---------------------------------------------------------------- transport

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('gridwire', { status: 200 });

    const body = await request.text();
    if (!(await verifySignature(request, body, env.DISCORD_PUBLIC_KEY))) {
      return new Response('invalid request signature', { status: 401 });
    }

    const interaction = JSON.parse(body);

    if (interaction.type === 1) return json({ type: 1 }); // PING -> PONG

    if (interaction.type === 2) {
      const redirect = wrongChannel(interaction, env);
      if (redirect) return json(reply(redirect, { ephemeral: true }));

      // Defer, then do the real work after responding — live provider calls
      // can't be trusted to beat Discord's 3-second interaction deadline.
      ctx.waitUntil(runCommand(interaction, env));
      return json({ type: 5 });
    }

    return new Response('unsupported interaction type', { status: 400 });
  },
};

async function verifySignature(request, body, publicKeyHex) {
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');
  if (!signature || !timestamp || !publicKeyHex) return false;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(publicKeyHex),
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body)
    );
  } catch {
    return false;
  }
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function json(payload) {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function reply(embed, { ephemeral = false } = {}) {
  return { type: 4, data: { embeds: [embed], flags: ephemeral ? 64 : 0 } };
}

/** Channel scoping: score commands live in the scores channel(s), the rest in schedule channel(s). */
function wrongChannel(interaction, env) {
  const name = interaction.data?.name;
  const scores = new Set(['score', 'apis']);
  const allowed = parseIds(scores.has(name) ? env.SCORES_CHANNEL_IDS : env.SCHEDULE_CHANNEL_IDS);
  if (allowed.size === 0 || allowed.has(interaction.channel_id)) return null;
  const [first] = allowed;
  return embed({
    color: COLORS.neutral,
    description: `\`/${name}\` works in <#${first}> — hop over there and try again.`,
  });
}

function parseIds(csv) {
  return new Set((csv ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}

async function runCommand(interaction, env) {
  let result;
  try {
    result = await handle(interaction, env);
  } catch (err) {
    console.error(`[worker] /${interaction.data?.name} failed:`, err);
    result = embed({
      color: COLORS.warn,
      title: 'Something went sideways',
      description: 'That command hit an error. Try again in a minute.',
    });
  }

  await fetch(
    `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [result], allowed_mentions: { parse: [] } }),
    }
  );
}

// ------------------------------------------------------------------ helpers

function embed(fields) {
  return { footer: FOOTER, timestamp: new Date().toISOString(), ...fields };
}

function ts(iso, style = 'F') {
  if (!iso) return 'TBD';
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${style}>`;
}

function opt(interaction, name) {
  return interaction.data?.options?.find((o) => o.name === name)?.value;
}

function seasonYear(env) {
  return env.SEASON_YEAR ? Number(env.SEASON_YEAR) : defaultSeasonYear();
}

/** week/phase options -> {seasonType, week}; defaults to the current slot. */
function chosenSlot(interaction, snapshot) {
  const phase = opt(interaction, 'phase');
  if (phase) {
    const [seasonType, week] = phase.split(':').map(Number);
    return { seasonType, week };
  }
  const week = opt(interaction, 'week');
  if (week) return { seasonType: 2, week };
  return currentSlot(snapshot?.games ?? {}) ?? { seasonType: 2, week: 1 };
}

async function loadRepoJson(path) {
  const res = await fetch(`${REPO_RAW}/${path}`, { cf: { cacheTtl: 60, cacheEverything: true } });
  if (!res.ok) return null;
  return res.json();
}

function slotGames(snapshot, { seasonType, week }) {
  return Object.values(snapshot?.games ?? {})
    .filter((g) => g.seasonType === seasonType && g.week === week)
    .sort((a, b) => (Date.parse(a.kickoff) || 0) - (Date.parse(b.kickoff) || 0));
}

function matchup(g) {
  return `${g.away?.name ?? '?'} @ ${g.home?.name ?? '?'}`;
}

function kickoffText(g) {
  if (!g.kickoff) return 'TBD';
  if (g.timeTBD) return `${ts(g.kickoff, 'D')} · time TBD`;
  return `${ts(g.kickoff, 'f')} (${ts(g.kickoff, 'R')})`;
}

// ----------------------------------------------------------------- commands

async function handle(interaction, env) {
  const name = interaction.data?.name;
  const year = seasonYear(env);
  const snapshot = await loadRepoJson(`data/snapshot-${year}.json`);

  switch (name) {
    case 'schedule':
      return cmdSchedule(interaction, snapshot, year);
    case 'kickoff':
      return cmdKickoff(interaction, snapshot, year);
    case 'deadline':
      return cmdDeadline(interaction, snapshot, year);
    case 'changes':
      return cmdChanges(year);
    case 'released':
      return cmdReleased(snapshot, year);
    case 'status':
      return cmdStatus(snapshot, year);
    case 'score':
      return cmdScore(interaction, snapshot, year);
    case 'apis':
      return cmdApis(env, year);
    default:
      return embed({ color: COLORS.warn, description: `Unknown command \`/${name}\`.` });
  }
}

function noSnapshot(year) {
  return embed({
    color: COLORS.warn,
    description: `No ${year} schedule data yet — the poller hasn't captured a snapshot.`,
  });
}

function cmdSchedule(interaction, snapshot, year) {
  if (!snapshot) return noSnapshot(year);
  const slot = chosenSlot(interaction, snapshot);
  const games = slotGames(snapshot, slot);
  const label = weekLabel(slot.seasonType, slot.week);

  if (games.length === 0) {
    return embed({
      color: COLORS.neutral,
      title: `📅 ${label} · ${year}`,
      description: 'Nothing on the schedule for this week yet.',
    });
  }

  const lines = games.map((g) => {
    const net = g.network ? ` · ${g.network}` : '';
    const dead = /postponed|canceled/i.test(g.statusName) ? ' · ⚠️ ' + g.statusName.replace('STATUS_', '').toLowerCase() : '';
    return `${kickoffText(g)} — **${matchup(g)}**${net}${dead}`;
  });

  return embed({
    color: COLORS.brand,
    title: `📅 ${label} · ${year} NFL Schedule`,
    description: lines.join('\n'),
    footer: { text: `${FOOTER.text} · ${games.length} games · times shown in your local time` },
  });
}

function cmdKickoff(interaction, snapshot, year) {
  if (!snapshot) return noSnapshot(year);
  const abbr = resolveTeam(opt(interaction, 'team'));
  if (!abbr) {
    return embed({
      color: COLORS.warn,
      description: `Couldn't match that team — try an abbreviation (\`DAL\`) or name (\`Cowboys\`).`,
    });
  }

  const mine = Object.values(snapshot.games ?? {}).filter(
    (g) => g.home?.abbr === abbr || g.away?.abbr === abbr
  );

  let game;
  const explicit = opt(interaction, 'week') || opt(interaction, 'phase');
  if (explicit) {
    const slot = chosenSlot(interaction, snapshot);
    game = mine.find((g) => g.seasonType === slot.seasonType && g.week === slot.week);
  } else {
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    game =
      mine
        .filter((g) => g.kickoff && Date.parse(g.kickoff) >= cutoff)
        .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))[0] ?? mine[mine.length - 1];
  }

  if (!game) {
    return embed({ color: COLORS.neutral, description: `No game found for **${abbr}** there.` });
  }

  return embed({
    color: COLORS.brand,
    title: `🏈 ${matchup(game)}`,
    description: `${weekLabel(game.seasonType, game.week)} · ${seasonTypeLabel(game.seasonType)} ${year}`,
    fields: [
      { name: 'Kickoff', value: kickoffText(game), inline: false },
      ...(game.venue ? [{ name: 'Venue', value: game.venue, inline: true }] : []),
      ...(game.network ? [{ name: 'TV', value: game.network, inline: true }] : []),
      ...(/postponed|canceled/i.test(game.statusName)
        ? [{ name: 'Status', value: '⚠️ ' + game.statusName.replace('STATUS_', '').toLowerCase(), inline: true }]
        : []),
    ],
  });
}

function cmdDeadline(interaction, snapshot, year) {
  if (!snapshot) return noSnapshot(year);
  const slot = chosenSlot(interaction, snapshot);
  const games = slotGames(snapshot, slot).filter((g) => g.kickoff);
  const label = weekLabel(slot.seasonType, slot.week);

  if (games.length === 0) {
    return embed({ color: COLORS.neutral, description: `No kickoffs on the schedule for ${label} yet.` });
  }

  const first = games[0];
  return embed({
    color: COLORS.brand,
    title: `⏰ Pick deadline — ${label}`,
    description:
      `First kickoff: **${matchup(first)}**\n${kickoffText(first)}` +
      (first.timeTBD ? '\n\n⚠️ Time not final yet — a flex move could shift this.' : ''),
    footer: { text: `${FOOTER.text} · get your picks in before this` },
  });
}

async function cmdChanges(year) {
  const log = await loadRepoJson(`data/changes-${year}.json`);
  const entries = (log?.entries ?? []).slice(-12).reverse();

  if (entries.length === 0) {
    return embed({
      color: COLORS.neutral,
      title: `🔁 Schedule changes · ${year}`,
      description: 'No changes logged yet this season. Quiet is good.',
    });
  }

  return embed({
    color: COLORS.brand,
    title: `🔁 Recent schedule changes · ${year}`,
    description: entries.map((e) => `${ts(e.at, 'R')} ${e.summary}`).join('\n'),
  });
}

async function cmdReleased(snapshot, year) {
  const regular = snapshot
    ? Object.values(snapshot.games ?? {}).filter((g) => g.seasonType === 2).length
    : 0;
  const released = regular >= 200;

  if (!released) {
    return embed({
      color: COLORS.neutral,
      title: `📅 ${year} schedule — not out yet`,
      description:
        `Only ${regular} regular-season games are published so far.\n` +
        'This channel gets an @everyone the moment the full schedule drops.',
    });
  }

  const log = await loadRepoJson(`data/changes-${year}.json`);
  const release = (log?.entries ?? []).find((e) => e.type === 'release');
  return embed({
    color: COLORS.final,
    title: `✅ The ${year} schedule is out`,
    description:
      `**${regular}** regular-season games on the slate.` +
      (release ? `\nReleased ${ts(release.at, 'R')}.` : ''),
  });
}

async function cmdStatus(snapshot, year) {
  if (!snapshot) return noSnapshot(year);
  const games = Object.keys(snapshot.games ?? {}).length;
  const log = await loadRepoJson(`data/changes-${year}.json`);
  const last = (log?.entries ?? []).at(-1);

  return embed({
    color: COLORS.brand,
    title: '🩺 Gridwire status',
    fields: [
      { name: 'Last poll', value: ts(snapshot.savedAt, 'R'), inline: true },
      { name: 'Provider', value: snapshot.provider ?? 'unknown', inline: true },
      { name: 'Games tracked', value: String(games), inline: true },
      { name: 'Last change alert', value: last ? ts(last.at, 'R') : 'none this season', inline: true },
      { name: 'Season', value: String(year), inline: true },
      { name: 'Poll cadence', value: 'every 30 min (GitHub Actions)', inline: true },
    ],
  });
}

async function cmdScore(interaction, snapshot, year) {
  const abbr = resolveTeam(opt(interaction, 'team'));
  if (!abbr) {
    return embed({
      color: COLORS.warn,
      description: `Couldn't match that team — try an abbreviation (\`DAL\`) or name (\`Cowboys\`).`,
    });
  }

  const slot = chosenSlot(interaction, snapshot);
  const { games, served } = await espn.fetchWeekScores(year, slot.seasonType, slot.week);
  if (!served) {
    return embed({
      color: COLORS.warn,
      title: 'Score source unavailable',
      description: 'ESPN (the live-score source) is not responding right now. Try again shortly, or check `/apis`.',
    });
  }

  const label = weekLabel(slot.seasonType, slot.week);
  const game = games.find((g) => g.home?.abbr === abbr || g.away?.abbr === abbr);
  if (!game) {
    return embed({ color: COLORS.neutral, description: `**${abbr}** doesn't play in ${label}.` });
  }

  const hasScore = game.homeScore != null && game.awayScore != null;

  if (!hasScore || /SCHEDULED/.test(game.statusName)) {
    return embed({
      color: COLORS.brand,
      title: `🏈 ${matchup(game)} — ${label}`,
      description: `Hasn't kicked off yet.\n${kickoffText(game)}`,
      footer: { text: `${FOOTER.text} · data: ESPN` },
    });
  }

  const scoreLine = `**${game.away?.abbr} ${game.awayScore} — ${game.homeScore} ${game.home?.abbr}**`;
  if (game.completed) {
    const winner =
      game.homeScore === game.awayScore
        ? "It's a tie."
        : game.homeScore > game.awayScore
          ? `**${game.home?.name}** win.`
          : `**${game.away?.name}** win.`;
    return embed({
      color: COLORS.final,
      title: `🏁 Final — ${matchup(game)}`,
      description: `${scoreLine}\n${winner}`,
      footer: { text: `${FOOTER.text} · ${label} ${year} · data: ESPN` },
    });
  }

  return embed({
    color: COLORS.live,
    title: `🔴 Live — ${matchup(game)}`,
    description: `${scoreLine}\n${game.statusDetail ?? 'in progress'}`,
    footer: { text: `${FOOTER.text} · ${label} ${year} · data: ESPN` },
  });
}

async function cmdApis(env, year) {
  const checks = await Promise.all([
    ping('ESPN', `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${year}&seasontype=2&week=1`),
    ping('nflverse', 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv', {
      headers: { Range: 'bytes=0-1023' },
    }),
    env.BALLDONTLIE_API_KEY
      ? ping('balldontlie', 'https://api.balldontlie.io/nfl/v1/teams?per_page=1', {
          headers: { Authorization: env.BALLDONTLIE_API_KEY },
        })
      : Promise.resolve({ name: 'balldontlie', status: 'unconfigured' }),
  ]);

  const CAPABILITY = {
    ESPN: 'schedule · live + final scores · no key needed\n[site.api.espn.com](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard)',
    nflverse: 'schedule · final scores · free public data\n[github.com/nflverse/nfldata](https://github.com/nflverse/nfldata)',
    balldontlie: 'schedule · scores · free key required\n[balldontlie.io](https://www.balldontlie.io)',
  };

  const fields = checks.map((c) => ({
    name: `${c.status === 'up' ? '✅' : c.status === 'unconfigured' ? '⚪' : '❌'} ${c.name}`,
    value:
      c.status === 'up'
        ? `responding · ${c.ms} ms\n${CAPABILITY[c.name]}`
        : c.status === 'unconfigured'
          ? `not configured\n${CAPABILITY[c.name]}`
          : `**down** — ${c.error}\n${CAPABILITY[c.name]}`,
    inline: true,
  }));

  const downCount = checks.filter((c) => c.status === 'down').length;
  return embed({
    color: downCount === 0 ? COLORS.final : downCount === checks.length ? COLORS.live : COLORS.warn,
    title: '📡 Provider status',
    description:
      downCount === 0
        ? 'All configured providers are responding.'
        : `${downCount} provider${downCount > 1 ? 's' : ''} down — the ladder fails over automatically.`,
    fields,
  });
}

async function ping(name, url, init = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
    return { name, status: 'up', ms: Date.now() - t0 };
  } catch (err) {
    return { name, status: 'down', error: err?.message ?? 'unreachable' };
  }
}
