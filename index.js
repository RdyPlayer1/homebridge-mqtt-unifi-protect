'use strict';

const MqttUnifiProtectPlatform = require('./platform');

module.exports = (api) => {
  api.registerPlatform(
    'homebridge-mqtt-unifi-protect', // npm package name
    'MqttUnifiProtectPlatform',      // platform name used in config.json/UI
    MqttUnifiProtectPlatform
  );
};
