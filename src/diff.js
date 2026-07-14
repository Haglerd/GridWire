/**
 * Compare the previous snapshot against a fresh fetch and produce the events
 * worth telling the pickem group about.
 *
 * Games are keyed by the cross-provider gameKey (slot + matchup), so a
 * provider failover doesn't read as 285 removed + 285 added games.
 */

/** How many "new game" events in one poll before we call it a schedule release. */
const RELEASE_THRESHOLD = 25;

/**
 * Postseason slates carry TBD-vs-TBD placeholder events until matchups are set
 * (and providers disagree on whether to carry them at all), so a placeholder
 * appearing/vanishing is dialect, not news. Kickoff changes on them still
 * alert — a Super Bowl time change is real information.
 */
function isPlaceholder(game) {
  const unknown = (t) => !t?.abbr || t.abbr === '?' || t.abbr === 'TBD';
  return unknown(game.home) || unknown(game.away);
}

/**
 * @param {Record<string, object>} prev      previous snapshot (gameKey -> game)
 * @param {Record<string, object>} next      fresh fetch (gameKey -> game)
 * @param {Set<string>} servedSlots          "seasonType:week" keys that answered this poll
 * @param {string|null} prevProvider         provider that built the snapshot
 * @param {string|null} nextProvider         provider that served this poll
 * @returns {{ release: object|null, changes: object[] }}
 */
export function diffSchedules(prev, next, servedSlots, prevProvider, nextProvider) {
  const sameProvider = prevProvider === nextProvider;

  const added = Object.values(next).filter((g) => !prev[g.key] && !isPlaceholder(g));

  // A wave of new games on a (near-)empty snapshot = the schedule dropped.
  // Announce it as one event instead of 285 individual posts.
  if (added.length >= RELEASE_THRESHOLD) {
    return {
      release: {
        gameCount: Object.keys(next).length,
        newCount: added.length,
      },
      // A re-release can also move existing games — still surface those.
      changes: [
        ...modifiedGames(prev, next, sameProvider),
        ...removedGames(prev, next, servedSlots),
      ],
    };
  }

  const changes = [
    ...added.map((g) => ({ type: 'added', game: g })),
    ...modifiedGames(prev, next, sameProvider),
    ...removedGames(prev, next, servedSlots),
  ];

  return { release: null, changes };
}

function modifiedGames(prev, next, sameProvider) {
  const changes = [];

  for (const g of Object.values(next)) {
    const old = prev[g.key];
    if (!old) continue;

    const fields = [];

    // Kickoff. TBD-time games carry provider-invented placeholder times (ESPN
    // says midnight ET, nflverse projects 1:00 PM), so an instant-vs-instant
    // compare involving a TBD side is comparing two guesses. Rules:
    //   - TBD -> real time (same provider): ALERT — that's the flex announcement.
    //   - both TBD but the DAY moved: ALERT on the day.
    //   - anything else involving a TBD side: suppress.
    //   - neither side TBD: compare as an instant ("Z" vs "+00:00" is not a flex move).
    const oldTBD = Boolean(old.timeTBD);
    const newTBD = Boolean(g.timeTBD);
    if (oldTBD || newTBD) {
      if (sameProvider && oldTBD && !newTBD && g.kickoff) {
        fields.push({ field: 'kickoff', from: old.kickoff, to: g.kickoff, fromTBD: true });
      } else if (oldTBD && newTBD && old.kickoff && g.kickoff && old.kickoff.slice(0, 10) !== g.kickoff.slice(0, 10)) {
        fields.push({ field: 'kickoff', from: old.kickoff, to: g.kickoff, fromTBD: true, toTBD: true });
      }
    } else if (old.kickoff && g.kickoff && Date.parse(old.kickoff) !== Date.parse(g.kickoff)) {
      fields.push({ field: 'kickoff', from: old.kickoff, to: g.kickoff });
    } else if (!old.kickoff !== !g.kickoff) {
      fields.push({ field: 'kickoff', from: old.kickoff, to: g.kickoff });
    }

    // Venue / network strings are provider dialects (ESPN says "Levi's Stadium",
    // nflverse says "Levi's Stadium" too — but not always). Only diff them when
    // the same provider produced both sides.
    if (sameProvider) {
      if (old.venue !== g.venue && g.venue && old.venue) {
        fields.push({ field: 'venue', from: old.venue, to: g.venue });
      }
      if (old.network !== g.network && g.network && old.network) {
        fields.push({ field: 'network', from: old.network, to: g.network });
      }
    }

    const oldBad = isDisrupted(old.statusName);
    const newBad = isDisrupted(g.statusName);
    if (oldBad !== newBad) {
      fields.push({ field: 'status', from: prettyStatus(old.statusName), to: prettyStatus(g.statusName) });
    }

    if (fields.length > 0) {
      changes.push({ type: 'modified', game: g, old, fields });
    }
  }

  return changes;
}

/**
 * A game only counts as removed if the week it USED to live in answered this
 * poll. If the provider failed to serve week 12, week 12's games aren't gone —
 * we just couldn't ask. (A game that moves weeks posts as removed+added, since
 * the week is part of its identity key — loud, which is the point.)
 */
function removedGames(prev, next, servedSlots) {
  const changes = [];
  for (const old of Object.values(prev)) {
    if (next[old.key]) continue;
    if (!servedSlots.has(`${old.seasonType}:${old.week}`)) continue;
    if (isPlaceholder(old)) continue;
    changes.push({ type: 'removed', game: old });
  }
  return changes;
}

function isDisrupted(statusName) {
  return statusName === 'STATUS_POSTPONED' || statusName === 'STATUS_CANCELED';
}

function prettyStatus(statusName) {
  return (statusName || 'UNKNOWN').replace(/^STATUS_/, '').toLowerCase().replace(/_/g, ' ');
}
