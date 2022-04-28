'use strict';

const { Listener } = require('@sapphire/framework');
const { NODE_ENV } = process.env;

module.exports = class extends Listener {
  run(...args) {
    if (NODE_ENV === 'development') console.log(...args);
  }
};
