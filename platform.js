const Accessory = require("./accessory");

let Service, Characteristic;

class MqttUnifiProtectPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;

    Service = api.hap.Service;
    Characteristic = api.hap.Characteristic;

    this.mqttUrl = config.mqttUrl;
    this.exitDelay = config.exitDelay || 30;
    this.alarmDuration = config.alarmDuration || 120;
    this.enableSiren = config.enableSiren ?? true;

    this.devices = config.devices || [];
    this.cachedAccessories = [];
    this.discovered = new Map();

    this.stateFile = api.user.storagePath() + "/mqtt-unifi-alarm.json";

    api.on("didFinishLaunching", () => {
      this.restoreState();
      this.connectMqtt();
    });
  }

  configureAccessory(accessory) {
    this.cachedAccessories.push(accessory);
  }

  connectMqtt() {
    this.client = mqtt.connect(this.mqttUrl);

    this.client.on("connect", () => {
      this.log("MQTT connected");
      this.client.subscribe("unifi/protect/+");
    });

    this.client.on("message", (topic, message) => {
      this.handleDiscovery(topic, message.toString());
    });
  }

  handleDiscovery(topic, payload) {
    const mac = topic.split("/")[2]?.toLowerCase();
    if (!mac) return;

    if (!this.discovered.has(mac)) {
      const configured = this.devices.find(d => d.mac.toLowerCase() === mac);

      const name = configured?.name || `Device ${mac.substring(0,6)}`;

      this.log("Discovered:", mac);

      const accessory = new Accessory(
        this,
        name,
        mac,
        configured || {}
      );

      this.discovered.set(mac, accessory);
    }

    this.discovered.get(mac).handleMessage(payload);
  }

  publishAlarmState(state) {
    if (!this.client) return;
    this.client.publish(
      "unifi/protect/alarm/state",
      state,
      { retain: true }
    );
  }

  restoreState() {
    try {
      const data = require(this.stateFile);
      this.currentState = data.state;
      this.log("Restored state:", this.currentState);
    } catch {
      this.currentState = Characteristic.SecuritySystemCurrentState.DISARMED;
    }
  }

  saveState() {
    require("fs").writeFileSync(
      this.stateFile,
      JSON.stringify({ state: this.currentState })
    );
  }
}

module.exports = MqttUnifiProtectPlatform;
