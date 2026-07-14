/**
 * Register the slash commands with Discord. Run once after any command
 * definition change: `npm run register`.
 *
 * Registers globally by default. Set DISCORD_GUILD_ID to register to one
 * guild instead — guild commands update instantly, global can take a few
 * minutes to propagate.
 */

import 'dotenv/config';
import { ALL_COMMANDS } from './commands/definitions.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('[register] DISCORD_TOKEN is required');
  process.exit(1);
}

const API = 'https://discord.com/api/v10';
const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };

const app = await (await fetch(`${API}/applications/@me`, { headers })).json();
if (!app.id) {
  console.error('[register] could not resolve application id — bad token?');
  process.exit(1);
}

const guildId = process.env.DISCORD_GUILD_ID;
const route = guildId
  ? `${API}/applications/${app.id}/guilds/${guildId}/commands`
  : `${API}/applications/${app.id}/commands`;

const res = await fetch(route, { method: 'PUT', headers, body: JSON.stringify(ALL_COMMANDS) });
if (!res.ok) {
  console.error(`[register] HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const registered = await res.json();
console.log(
  `[register] ${registered.length} commands registered ${guildId ? `to guild (instant)` : 'globally (may take a few minutes)'}: ${registered.map((c) => '/' + c.name).join(', ')}`
);
