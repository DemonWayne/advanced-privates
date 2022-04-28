'use strict';

const { Listener } = require('@sapphire/framework');

module.exports = class extends Listener {
  run(oldState, newState) {
    require('../handlers/privates').handleVoiceState(this.container.client, oldState, newState);
  }
};
