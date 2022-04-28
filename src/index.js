'use strict';

const { SapphireClient } = require('@sapphire/framework');
require('@sapphire/plugin-logger/register');
const { DISCORD_TOKEN } = require('dotenv').config();

const client = new SapphireClient({
  intents: ['GUILDS', 'GUILD_MEMBERS', 'GUILD_VOICE_STATES', 'GUILD_MESSAGES'],
  allowedMentions: false,
});

client.login(DISCORD_TOKEN);
