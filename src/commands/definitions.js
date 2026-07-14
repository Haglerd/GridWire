/**
 * Slash command definitions — plain interaction-API JSON so both the Node
 * registration script and the Cloudflare Worker can use them without
 * discord.js. Option types: 3 = string, 4 = integer.
 */

const weekOption = {
  type: 4,
  name: 'week',
  description: 'Regular-season week (1–18). Omit for the current week.',
  min_value: 1,
  max_value: 18,
  required: false,
};

const phaseOption = {
  type: 3,
  name: 'phase',
  description: 'Playoff round instead of a regular-season week.',
  required: false,
  choices: [
    { name: 'Wild Card', value: '3:1' },
    { name: 'Divisional', value: '3:2' },
    { name: 'Conference Championship', value: '3:3' },
    { name: 'Super Bowl', value: '3:5' },
  ],
};

const teamOption = (required) => ({
  type: 3,
  name: 'team',
  description: 'Team — abbreviation, city, or name (e.g. DAL, Cowboys).',
  required,
  max_length: 40,
});

/** Commands answered from the committed schedule snapshot. */
export const SCHEDULE_COMMANDS = [
  {
    name: 'schedule',
    description: "A week's slate — kickoff times in your local time, plus network.",
    options: [weekOption, phaseOption],
  },
  {
    name: 'kickoff',
    description: "When a team's game starts (their next game, or a specific week).",
    options: [teamOption(true), weekOption, phaseOption],
  },
  {
    name: 'deadline',
    description: "First kickoff of the week — the pick lock time.",
    options: [weekOption, phaseOption],
  },
  {
    name: 'changes',
    description: 'Recent schedule changes the bot has alerted on.',
    options: [],
  },
  {
    name: 'released',
    description: "Has this season's schedule been released yet?",
    options: [],
  },
  {
    name: 'status',
    description: 'Bot health — last poll, provider used, games tracked.',
    options: [],
  },
];

/** Commands that hit live score data. */
export const SCORES_COMMANDS = [
  {
    name: 'score',
    description: "A game's score / winner — live or final.",
    options: [teamOption(true), weekOption, phaseOption],
  },
  {
    name: 'apis',
    description: 'Which score/schedule APIs are responding right now.',
    options: [],
  },
];

/** Usable in any channel; replies ephemerally. */
export const GLOBAL_COMMANDS = [
  {
    name: 'help',
    description: 'What Gridwire is, what it posts, and every command.',
    options: [],
  },
];

export const ALL_COMMANDS = [...SCHEDULE_COMMANDS, ...SCORES_COMMANDS, ...GLOBAL_COMMANDS];

export const SCORES_COMMAND_NAMES = new Set(SCORES_COMMANDS.map((c) => c.name));
