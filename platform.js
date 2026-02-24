'use strict';

const mqtt = require('mqtt');

let Service, Characteristic;

class MqttUnifiProtectPlatform {

  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.accessory = null;
    this.client = null;

    // Flattened config
    this.alarmName = this.config.alarmName || 'Home Alarm';
    this.exitDelay = Number(this.config.exitDelay || 0);
    this.alarmDuration = Number(this.config.alarmDuration || 120);
    this.devices = this.normalizeDevices(this.config.devices || []);

    this.currentState = 3; // DISARMED
    this.targetState = 3;  // DISARMED

    if (api) {
      Service = api.hap.Service;
      Characteristic = api.hap.Characteristic;

      api.on('didFinishLaunching', () => {
        this.log.info('Homebridge finished launching.');
        this.setupAccessory();
        this.setupMqtt();
      });
    }
  }

  // Normalize MAC addresses
  normalizeDevices(devices) {
    return devices.map(d => {
      if (d.mac) {
        d.mac = d.mac.replace(/[:\-]/g, '').toUpperCase();
      }
      return d;
    });
  }

  configureAccessory(accessory) {
    this.accessory = accessory;
    this.log.info(`Loaded cached accessory: ${accessory.displayName}`);
  }

  setupAccessory() {
    const uuid = this.api.hap.uuid.generate('mqtt-unifi-protect-alarm');

    if (!this.accessory) {
      this.accessory = new this.api.platformAccessory(this.alarmName, uuid);
      this.api.registerPlatformAccessories(
        'homebridge-mqtt-unifi-protect',
        'MqttUnifiProtectPlatform',
        [this.accessory]
      );
      this.log.info('Created new alarm accessory.');
    }

    const service =
      this.accessory.getService(Service.SecuritySystem) ||
      this.accessory.addService(Service.SecuritySystem);

    service.setCharacteristic(Characteristic.SecuritySystemCurrentState, this.currentState);
    service.setCharacteristic(Characteristic.SecuritySystemTargetState, this.targetState);

    service.getCharacteristic(Characteristic.SecuritySystemTargetState)
      .onSet(this.handleSetTargetState.bind(this));
  }

  setupMqtt() {
    if (!this.config.mqttHost) {
      this.log.error('MQTT Host not configured.');
      return;
    }

    const url = `mqtt://${this.config.mqttHost}:${this.config.mqttPort || 1883}`;
    this.client = mqtt.connect(url, {
      username: this.config.mqttUsername,
      password: this.config.mqttPassword
    });

    this.client.on('connect', () => {
      this.log.info('✅ MQTT broker connected successfully.');
      this.client.subscribe('#');
    });

    this.client.on('error', err => {
      this.log.error('MQTT Error:', err.message);
    });

    this.client.on('message', (topic, message) => {
      this.handleMqttMessage(topic, message.toString());
    });
  }

  handleSetTargetState(value) {
    this.targetState = value;

    const arming =
      value === Characteristic.SecuritySystemTargetState.AWAY_ARM ||
      value === Characteristic.SecuritySystemTargetState.STAY_ARM;

    if (arming && this.exitDelay > 0) {
      this.log.info(`Exit delay started: ${this.exitDelay} seconds`);

      setTimeout(() => {
        this.currentState = value;
        this.updateCurrentState();
        this.log.info('System armed.');
      }, this.exitDelay * 1000);

    } else {
      this.currentState = value;
      this.updateCurrentState();
      this.log.info('System state changed immediately.');
    }
  }

  updateCurrentState() {
    if (!this.accessory) return;

    const service = this.accessory.getService(Service.SecuritySystem);
    service.updateCharacteristic(Characteristic.SecuritySystemCurrentState, this.currentState);
  }

  handleMqttMessage(topic, payload) {
    const device = this.devices.find(d =>
      topic.toUpperCase().includes(d.mac)
    );

    if (!device) return;

    const triggered =
      payload === 'true' ||
      payload === '1' ||
      payload.toLowerCase() === 'open' ||
      payload.toLowerCase() === 'motion';

    if (!triggered) return;
    if (!this.isSensorArmed(device)) return;

    this.log.warn(`🚨 Alarm triggered by: ${device.name}`);

    if (device.entryDelay > 0) {
      this.log.info(`Entry delay started for ${device.name}: ${device.entryDelay}s`);
      setTimeout(() => {
        if (this.isSystemStillArmed()) this.triggerAlarm();
      }, device.entryDelay * 1000);
    } else {
      this.triggerAlarm();
    }
  }

  isSystemStillArmed() {
    return (
      this.currentState === Characteristic.SecuritySystemCurrentState.AWAY_ARM ||
      this.currentState === Characteristic.SecuritySystemCurrentState.STAY_ARM
    );
  }

  triggerAlarm() {
    this.currentState = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
    this.updateCurrentState();

    setTimeout(() => {
      this.currentState = this.targetState;
      this.updateCurrentState();
      this.log.info('Alarm reset.');
    }, this.alarmDuration * 1000);
  }

  isSensorArmed(device) {
    if (this.currentState === Characteristic.SecuritySystemCurrentState.DISARMED) {
      return device.monitorOff === true;
    }
    if (this.currentState === Characteristic.SecuritySystemCurrentState.STAY_ARM) {
      return device.armHome === true;
    }
    if (this.currentState === Characteristic.SecuritySystemCurrentState.AWAY_ARM) {
      return device.armAway === true;
    }
    return false;
  }
}

module.exports = MqttUnifiProtectPlatform;
