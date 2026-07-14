# Gridwire

**by Ghostwire Systems**

A Discord bot for pickem groups that watches the NFL schedule and posts to a channel when something changes — flex moves, kickoff time changes, postponements/cancellations, added or removed games — and announces the moment the new season's schedule drops.

## How it works

- Polls a **provider ladder**: **ESPN** site.api scoreboard first, **nflverse** `games.csv` if ESPN is down, **balldontlie** NFL v1 if a key is configured. One poll's data always comes from one provider — never a merge.
- Normalizes every provider into the same game record, keyed by `seasonType:week:AWAY@HOME` so a provider failover doesn't read as the whole schedule changing.
- Diffs against the last snapshot (`data/snapshot-<year>.json`) and posts embeds to the configured channel, tagging `@everyone`.
- A wave of 25+ new games on an empty snapshot is announced as **one** "schedule is out!" post, not 285 individual ones.
- Kickoff times post as Discord `<t:…>` timestamps, so everyone sees their own local time.
- First run captures a baseline silently — no alert spam for games everyone already knows about.
- Snapshots only save **after** alerts post, so a Discord hiccup re-alerts next tick instead of swallowing the change.

Hard-won rules from production incidents are baked in: ESPN requests always pin the season with an explicit `dates=` param, and any payload that declares a different season/week than requested is refused, not trusted.

## Setup

1. Create the bot: [Discord Developer Portal](https://discord.com/developers/applications) → New Application → Bot → copy the **token**. No privileged intents needed.
2. Invite it: OAuth2 → URL Generator → scope `bot` → permissions **View Channels**, **Send Messages**, **Embed Links**, **Mention Everyone** → open the URL, pick your server.
3. Configure:
   ```
   cp .env.example .env   # fill in DISCORD_TOKEN + DISCORD_CHANNEL_ID
   npm install
   ```
4. Run:
   ```
   npm start              # poll forever (every POLL_MINUTES, default 30)
   npm run once           # single poll, then exit (good for cron)
   npm run dry-run        # single poll, print messages to console, no Discord
   ```

### Run it on GitHub Actions (no server needed)

This repo ships with `.github/workflows/poll.yml`, which runs `npm run once` every 30 minutes on GitHub's runners and commits the updated snapshot back to the repo. To use it on your own fork: add `DISCORD_TOKEN` and `DISCORD_CHANNEL_ID` under **Settings → Secrets and variables → Actions**. Secrets are encrypted and never visible in the public repo or its logs.

## Backlog

- **SQL/CSV generator** — an admin registers an example `INSERT` from their own schedules table; on changes the bot attaches the matching `UPDATE` statement, and on schedule release it attaches a full `.sql`/`.csv` of inserts for their schema. (Queued 2026-07-14 — MVP is alert + tag only.)
- Slash commands (`/schedule week 7`, subscribe/unsubscribe per channel)
- Multi-guild support with per-guild channels
- Score / result posting

## License

Private — Ghostwire Systems.
