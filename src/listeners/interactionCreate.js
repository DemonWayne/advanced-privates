'use strict';

const { Listener } = require('@sapphire/framework');

module.exports = class extends Listener {
  run(interaction) {
    require('../handlers/privates').handleInteraction(this.container.client, interaction);
  }
};
