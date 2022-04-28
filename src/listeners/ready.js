'use strict';

const { Listener } = require('@sapphire/framework');
const { checkMainMessage, checkParentPrivate, checkChildChannels } = require('../handlers/privates');

module.exports = class extends Listener {
  run(client) {
    this.container.logger.info(`[Ready] Бот запущен и авторизован как ${client.user.tag}`);

    setInterval(() => {
      checkMainMessage(client);
      checkParentPrivate(client);
      checkChildChannels(client);
    }, 10 * 1000);
  }
};
