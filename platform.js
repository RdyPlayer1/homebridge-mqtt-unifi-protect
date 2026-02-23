const Accessory = require('./accessory');
const mqtt = require('mqtt');

let Service, Characteristic;

class MqttUnifiProtectPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;

    Service = api.hap.Service;
    Characteristic = api.hap.Characteristic;

    this.devices = config.devices || [];
    this.exitDelay = config.exitDelay || 30;
    this.alarmDuration = config.alarmDuration || 120;
    this.alarmName = config.alarmName || 'Home Alarm';
    this.accessories = [];

    this.mqttClient = null;

    api.on('didFinishLaunching', () => {
      this.setupAlarmAccessory();
      this.setupDevices();
      this.connectMqtt();
      this.log('Platform finished launching.');
    });
  }

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }

  connectMqtt() {
    if (!this.config.mqttHost) return;

    const options = {
      host: this.config.mqttHost,
      port: this.config.mqttPort || 1883,
      username: this.config.mqttUsername,
      password: this.config.mqttPassword,
      reconnectPeriod: 5000
    };

    this.mqttClient = mqtt.connect(options);

    this.mqttClient.on('connect', () => {
      this.log(`MQTT broker connected: ${this.config.mqttHost}:${options.port}`);
      // Subscribe to device topics if needed
      this.devices.forEach(d => {
        const topic = `unifi/protect/${d.mac}`;
        this.mqttClient.subscribe(topic, err => {
          if (!err) this.log(`Subscribed to ${topic}`);
        });
      });
    });

    this.mqttClient.on('message', (topic, message) => {
      const msg = message.toString();
      const mac = topic.split('/')[2];
      const device = this.devices.find(d => d.mac === mac);
      if (device && device.accessory) {
        device.accessory.handleMessage(msg);
      }
    });

    this.mqttClient.on('error', (err) => {
      this.log('MQTT error:', err);
    });

    this.mqttClient.on('reconnect', () => {
      this.log('Reconnecting to MQTT broker...');
    });
  }

  publishMqtt(topic, message) {
    if (this.mqttClient && this.mqttClient.connected) {
      this.mqttClient.publish(topic, message.toString());
      this.log(`MQTT published to ${topic}: ${message}`);
    }
  }

  setupAlarmAccessory() {
    const uuid = this.api.hap.uuid.generate('mqtt-unifi-alarm');
    let alarmAccessory = this.accessories.find(a => a.UUID === uuid);

    if (!alarmAccessory) {
      alarmAccessory = new this.api.platformAccessory(this.alarmName, uuid);

      const alarmService = alarmAccessory.addService(Service.SecuritySystem, this.alarmName);

      alarmService.setCharacteristic(
        Characteristic.SecuritySystemCurrentState,
        Characteristic.SecuritySystemCurrentState.DISARMED
      );
      alarmService.setCharacteristic(
        Characteristic.SecuritySystemTargetState,
        Characteristic.SecuritySystemTargetState.DISARM
      );

      this.api.registerPlatformAccessories(
        'homebridge-mqtt-unifi-protect',
        'MqttUnifiProtectPlatform',
        [alarmAccessory]
      );

      this.accessories.push(alarmAccessory);
      this.log(`Alarm accessory "${this.alarmName}" created.`);
    }
  }

  setupDevices() {
    this.devices.forEach(d => {
      if (!d.accessory) {
        d.accessory = new Accessory(this, d.name, d.mac, d);
      }
    });
  }

  triggerAlarm(state) {
    const alarm = this.accessories.find(a => a.getService(Service.SecuritySystem));
    if (!alarm) return;

    const service = alarm.getService(Service.SecuritySystem);
    const HAP = Characteristic;

    service.setCharacteristic(HAP.SecuritySystemCurrentState, state);
    service.setCharacteristic(HAP.SecuritySystemTargetState, state);

    // Publish to MQTT
    this.publishMqtt('unifi/protect/alarm/state', state.toString());
  }
}

module.exports = MqttUnifiProtectPlatform;
