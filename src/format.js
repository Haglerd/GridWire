/**
 * Turn diff events into Discord messages. Kickoff times use Discord's <t:…>
 * markers so every group member sees their own local time.
 */

import { EmbedBuilder } from 'discord.js';
import { weekLabel } from './providers/common.js';

const FOOTER = 'Gridwire · Ghostwire Systems';

const COLORS = {
  release: 0x2ecc71,
  added: 0x3498db,
  modified: 0xf1c40f,
  removed: 0xe74c3c,
  disrupted: 0xe74c3c,
};

export function ts(iso, style = 'F') {
  if (!iso) return 'TBD';
  const unix = Math.floor(new Date(iso).getTime() / 1000);
  return `<t:${unix}:${style}>`;
}

function matchup(game) {
  return `${game.away?.name ?? '?'} @ ${game.home?.name ?? '?'}`;
}

/** One plain-markdown line per change, for the change log / /changes replies. */
export function changeSummary(change) {
  const g = change.game;
  const week = weekLabel(g.seasonType, g.week);

  if (change.type === 'added') return `➕ **${matchup(g)}** added to ${week}`;
  if (change.type === 'removed') return `➖ **${matchup(g)}** removed from ${week}`;

  const parts = change.fields.map((f) => {
    if (f.field === 'kickoff') {
      const from = f.fromTBD ? `${ts(f.from, 'D')} (TBD)` : ts(f.from, 'f');
      const to = f.toTBD ? `${ts(f.to, 'D')} (TBD)` : ts(f.to, 'f');
      return `kickoff ${from} → ${to}`;
    }
    return `${f.field} ${f.from} → ${f.to}`;
  });
  return `🔁 **${matchup(g)}** (${week}): ${parts.join(' · ')}`;
}

export function releaseEmbed(seasonYear, release) {
  return new EmbedBuilder()
    .setColor(COLORS.release)
    .setTitle(`🏈 The ${seasonYear} NFL schedule is out!`)
    .setDescription(
      `${release.newCount} games just landed (${release.gameCount} total on the slate).\n` +
        `Time to set up the pickem — schedule changes will be posted here as they happen.`
    )
    .setFooter({ text: FOOTER })
    .setTimestamp();
}

export function changeEmbed(seasonYear, change) {
  const g = change.game;
  const week = weekLabel(g.seasonType, g.week);

  if (change.type === 'added') {
    return new EmbedBuilder()
      .setColor(COLORS.added)
      .setTitle(`➕ Game added — ${week}`)
      .setDescription(
        `**${matchup(g)}**\nKickoff: ${
          !g.kickoff ? 'TBD' : g.timeTBD ? `${ts(g.kickoff, 'D')} (time TBD)` : `${ts(g.kickoff)} (${ts(g.kickoff, 'R')})`
        }`
      )
      .setFooter({ text: `${FOOTER} · ${seasonYear} season` })
      .setTimestamp();
  }

  if (change.type === 'removed') {
    return new EmbedBuilder()
      .setColor(COLORS.removed)
      .setTitle(`➖ Game removed — ${week}`)
      .setDescription(`**${matchup(g)}** is no longer on the schedule.`)
      .setFooter({ text: `${FOOTER} · ${seasonYear} season` })
      .setTimestamp();
  }

  // modified
  const lines = change.fields.map((f) => {
    if (f.field === 'kickoff') {
      // A TBD side has a placeholder time — show only the date for it.
      const from = f.fromTBD ? `${ts(f.from, 'D')} (time TBD)` : ts(f.from);
      const to = f.toTBD ? `${ts(f.to, 'D')} (time TBD)` : `${ts(f.to)} (${ts(f.to, 'R')})`;
      return `**Kickoff:** ${from} → ${to}`;
    }
    const label = f.field.charAt(0).toUpperCase() + f.field.slice(1);
    return `**${label}:** ${f.from} → ${f.to}`;
  });

  const disrupted = change.fields.some(
    (f) => f.field === 'status' && /postponed|canceled/.test(f.to)
  );

  return new EmbedBuilder()
    .setColor(disrupted ? COLORS.disrupted : COLORS.modified)
    .setTitle(`${disrupted ? '🚨' : '🔁'} Schedule change — ${week}`)
    .setDescription(`**${matchup(g)}**\n${lines.join('\n')}`)
    .setFooter({ text: `${FOOTER} · ${seasonYear} season — go update your schedule!` })
    .setTimestamp();
}

/** Discord allows max 10 embeds per message; chunk accordingly. */
export function chunkEmbeds(embeds, size = 10) {
  const out = [];
  for (let i = 0; i < embeds.length; i += size) out.push(embeds.slice(i, i + size));
  return out;
}
