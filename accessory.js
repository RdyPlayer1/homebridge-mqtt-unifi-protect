let Service, Characteristic;

class AlarmAccessory {
  constructor(platform, name, mac, config) {
    this.platform = platform;
    this.log = platform.log;
    this.api = platform.api;

    Service = this.api.hap.Service;
    Characteristic = this.api.hap.Characteristic;

    this.name = name;
    this.mac = mac;
    this.config = config;

    this.entryDelay = config.entryDelay || 0;
    this.armHome = config.armHome ?? true;
    this.armAway = config.armAway ?? true;
    this.monitorOff = config.monitorOff ?? false;

    this.createServices();
  }

  createServices() {
    if (this.config.type === "motion") {
      this.sensorService = new Service.MotionSensor(this.name);
    } else {
      this.sensorService = new Service.ContactSensor(this.name);
    }

    if (this.platform.enableSiren && !this.platform.sirenService) {
      this.platform.sirenService = new Service.Switch("Alarm Siren");

      this.platform.sirenService
        .getCharacteristic(Characteristic.On)
        .onSet(this.handleSiren.bind(this));
    }
  }

  handleMessage(payload) {
    const [type, valueRaw] = payload.split("=");
    const active = valueRaw?.trim().toLowerCase() === "true";

    if (!active) return;
    if (!this.isArmed()) return;

    if (this.entryDelay > 0) {
      setTimeout(() => this.trigger(), this.entryDelay * 1000);
    } else {
      this.trigger();
    }
  }

  isArmed() {
    const state = this.platform.currentState;

    switch (state) {
      case Characteristic.SecuritySystemCurrentState.STAY_ARM:
        return this.armHome;
      case Characteristic.SecuritySystemCurrentState.AWAY_ARM:
        return this.armAway;
      case Characteristic.SecuritySystemCurrentState.DISARMED:
        return this.monitorOff;
      default:
        return false;
    }
  }

  trigger() {
    this.platform.currentState =
      Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;

    this.platform.publishAlarmState("triggered");
    this.platform.saveState();

    if (this.platform.sirenService) {
      this.platform.sirenService
        .getCharacteristic(Characteristic.On)
        .updateValue(true);
    }

    setTimeout(() => {
      if (this.platform.sirenService) {
        this.platform.sirenService
          .getCharacteristic(Characteristic.On)
          .updateValue(false);
      }
    }, this.platform.alarmDuration * 1000);
  }

  handleSiren(value) {
    this.platform.publishAlarmState(value ? "siren_on" : "siren_off");
  }
}

module.exports = AlarmAccessory;
