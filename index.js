module.exports = (api) => {
  api.registerPlatform(
    "homebridge-mqtt-unifi-protect",
    "MqttUnifiProtectPlatform",
    require("./platform"),
    true
  );
};
