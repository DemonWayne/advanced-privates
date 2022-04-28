'use strict';

const { Listener } = require('@sapphire/framework');
const { Permissions } = require('discord.js');
const { settings: guilds } = require('../data/config');

module.exports = class extends Listener {
  run(message) {
    const guild = guilds[message.guild.id];

    const isInAnotherChannel = message.channel.id !== guild.text_channel;
    const isMemberAdmin = message.member.permissions.has(Permissions.FLAGS.ADMINISTRATOR);
    if (isInAnotherChannel || isMemberAdmin) return;

    try {
      message.delete();
    } catch (err) {
      console.error(err);
    }
  }
};
