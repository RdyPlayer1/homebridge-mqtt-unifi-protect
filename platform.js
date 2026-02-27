'use strict';

const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');

module.exports = class MqttUnifiProtectPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.config = config || {};

    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.ALARM_UUID = api.hap.uuid.generate(
      'homebridge-mqtt-unifi-protect:alarm:v1'
    );

    this.stateFile = path.join(
      api.user.storagePath(),
      'homebridge-mqtt-unifi-protect-state.json'
    );

    this.state = {
      targetState: this.Characteristic.SecuritySystemTargetState.DISARM,
      currentState: this.Characteristic.SecuritySystemCurrentState.DISARMED,
    };
    Object.assign(this.state, this.loadState());

    this.exitDelay = Math.max(0, Number(this.config.exitDelay ?? 0));
    this.alarmDuration = Math.max(1, Number(this.config.alarmDuration ?? 1));

    this.exitTimer = null;
    this.alarmTimer = null;

    this.alarmAccessory = null;
    this.mqttClient = null;

    api.on('didFinishLaunching', () => this.didFinishLaunching());
  }

  configureAccessory(accessory) {
    if (accessory.UUID === this.ALARM_UUID) {
      this.alarmAccessory = accessory;
    }
  }

  didFinishLaunching() {
    this.setupAlarm();
    this.setupZones();
    this.connectMQTT();
  }

  /* ---------------- ALARM ---------------- */

  setupAlarm() {
    if (!this.alarmAccessory) {
      this.alarmAccessory = new this.api.platformAccessory(
        this.config.alarmName || 'Home Alarm',
        this.ALARM_UUID
      );
      this.api.registerPlatformAccessories(
        'homebridge-mqtt-unifi-protect',
        'MqttUnifiProtectPlatform',
        [this.alarmAccessory]
      );
    }

    this.alarmService =
      this.alarmAccessory.getService(this.Service.SecuritySystem) ||
      this.alarmAccessory.addService(this.Service.SecuritySystem);

    this.alarmService
      .getCharacteristic(this.Characteristic.SecuritySystemTargetState)
      .on('set', (value, cb) => {
        this.setTargetState(value);
        cb();
      });

    this.alarmService.updateCharacteristic(
      this.Characteristic.SecuritySystemCurrentState,
      this.state.currentState
    );
  }

  setTargetState(value) {
    const C = this.Characteristic;
    clearTimeout(this.exitTimer);
    clearTimeout(this.alarmTimer);
    this.state.targetState = value;

    if (value === C.SecuritySystemTargetState.DISARM) {
      this.state.currentState = C.SecuritySystemCurrentState.DISARMED;
      return this.updateState();
    }

    const arm = () => {
      this.state.currentState =
        value === C.SecuritySystemTargetState.STAY_ARM
          ? C.SecuritySystemCurrentState.STAY_ARM
          : value === C.SecuritySystemTargetState.AWAY_ARM
          ? C.SecuritySystemCurrentState.AWAY_ARM
          : C.SecuritySystemCurrentState.NIGHT_ARM;

      this.updateState();
    };

    if (this.exitDelay === 0) arm();
    else {
      this.log.info(`Exit delay ${this.exitDelay}s`);
      this.exitTimer = setTimeout(arm, this.exitDelay * 1000);
    }
  }

  /* ---------------- ZONES ---------------- */

  setupZones() {
    for (const zone of this.config.devices || []) {
      const mac = zone.mac.replace(/:/g, '').toUpperCase();
      const uuid = this.api.hap.uuid.generate(`zone:${mac}`);

      let serviceType =
                 zone.type === 'motion'
           ? this.Service.MotionSensor
           : this.Service.ContactSensor;
 
       const service =
         this.alarmAccessory.getService(uuid) ||
         this.alarmAccessory.addService(serviceType, zone.name, uuid);
 
       // initialize context
       service.context = service.context || {};
       service.context.zone = {
         name: zone.name,
         mac,
         type: zone.type,
         armHome: !!zone.armHome,
         armAway: !!zone.armAway,
         entryDelay: Math.max(0, Number(zone.entryDelay ?? 0)),
       };
 
       // Initialize HomeKit state (false = not triggered)
       if (serviceType === this.Service.MotionSensor) {
         service.getCharacteristic(this.Characteristic.MotionDetected).updateValue(false);
       } else {
         service
           .getCharacteristic(this.Characteristic.ContactSensorState)
          .updateValue(this.Characteristic.ContactSensorState.CONTACT_DETECTED);
       }
 
      // Keep the service name in sync with config.
      // NOTE: SerialNumber is only valid on AccessoryInformation, not Contact/Motion services.
       service.displayName = zone.name;
      service
        .getCharacteristic(this.Characteristic.Name)
        .updateValue(zone.name);
     }
   }
 
   /* ---------------- MQTT ---------------- */
 
   connectMQTT() {
     if (!this.config.mqttHost) return;
 
     this.mqttClient = mqtt.connect({
       host: this.config.mqttHost,
       port: this.config.mqttPort || 1883,
       username: this.config.mqttUsername,
       password: this.config.mqttPassword,
       reconnectPeriod: 0,
     });
 
     this.mqttClient.on('connect', () => {
      const topic = '#';
      this.log.info(`MQTT connected, subscribing to ${topic}`);
      this.mqttClient.subscribe(topic, {}, (err) => {
        if (err) this.log.error(`MQTT subscribe failed for ${topic}`);
        else this.log.info(`Subscribed to ${topic}`);
      });
     });
 
     this.mqttClient.on('error', (err) => {
       this.log.error(`MQTT error: ${err.message}, retrying in 60s`);
       setTimeout(() => this.connectMQTT(), 60_000);
     });
 
     this.mqttClient.on('message', (topic, msg) => this.handleMQTT(topic, msg));
   }
 
   handleMQTT(topic, msg) {
    const rawMessage = msg.toString().trim();
 
     for (const service of this.alarmAccessory.services) {
       const z = service.context?.zone;
       if (!z) continue;
      if (!this.topicMatchesZone(topic, z.mac)) continue;

      const normalized = rawMessage.toLowerCase();
      if (normalized !== 'true' && normalized !== 'false') {
        this.log.error(
          `Invalid MQTT payload for topic ${topic}: "${rawMessage}". Expected "true" or "false".`
        );
        return;
      }
 
      const triggered = normalized === 'true';

      if (z.type === 'motion') {
         service.getCharacteristic(this.Characteristic.MotionDetected).updateValue(triggered);
      } else if (z.type === 'contact') {
         const contactState = triggered
          ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : this.Characteristic.ContactSensorState.CONTACT_DETECTED;
         service.getCharacteristic(this.Characteristic.ContactSensorState).updateValue(contactState);
       }
 
       if (triggered) this.triggerAlarm(z);
       return; // stop after first match
     }
   }
 

  topicMatchesZone(topic, mac) {
    if (typeof topic !== 'string') return false;

    const normalizedTopic = topic.toUpperCase();
    return normalizedTopic.includes(mac);
  }

   triggerAlarm(zone) {
     const C = this.Characteristic;
 
const armed =
  (this.state.targetState === C.SecuritySystemTargetState.AWAY_ARM && zone.armAway) ||
  ((this.state.targetState === C.SecuritySystemTargetState.STAY_ARM ||
    this.state.targetState === C.SecuritySystemTargetState.NIGHT_ARM) &&
    zone.armHome);
 
     if (!armed) return;
 
     const fire = () => {
       this.log.warn(`🚨 Alarm triggered by ${zone.name}`);
       this.state.currentState = C.SecuritySystemCurrentState.ALARM_TRIGGERED;
       this.updateState();
 
       this.alarmTimer = setTimeout(() => {
         this.setTargetState(this.state.targetState);
       }, this.alarmDuration * 1000);
     };
 
     if (zone.entryDelay === 0) fire();
     else setTimeout(fire, zone.entryDelay * 1000);
   }
 
    /* ---------------- STATE ---------------- */

  updateState() {
    this.alarmService.updateCharacteristic(
      this.Characteristic.SecuritySystemCurrentState,
      this.state.currentState
    );
    this.saveState();
  }

  saveState() {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state));
    } catch (err) {
      this.log.error('Failed to save alarm state:', err);
    }
  }

  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        return JSON.parse(fs.readFileSync(this.stateFile));
      }
    } catch (err) {
      this.log.error('Failed to load alarm state:', err);
    }
    return {};
  }
};
