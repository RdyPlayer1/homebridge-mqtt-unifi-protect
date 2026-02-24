class Accessory {
  constructor(platform, config) {
    this.platform = platform;
    this.config = config;
    this.name = config.name;

    const Service = platform.api.hap.Service;
    const Characteristic = platform.api.hap.Characteristic;

    this.service =
      config.type === 'motion'
        ? new Service.MotionSensor(this.name)
        : new Service.ContactSensor(this.name);

    this.armHome = config.armHome;
    this.armAway = config.armAway;
    this.monitorOff = config.monitorOff;
    this.entryDelay = config.entryDelay || 0;
  }

  handleMessage(value) {
    const state = this.platform.getSystemState();
    const active =
      (state === 'home' && this.armHome) ||
      (state === 'away' && this.armAway) ||
      (state === 'off' && this.monitorOff);

    if (!active) return;
    if (value !== 'true') return;

    this.platform.log(`${this.name} triggered.`);

    if (this.entryDelay > 0) {
      this.platform.log(`Entry delay (${this.entryDelay}s) for ${this.name}`);
      setTimeout(() => {
        this.platform.triggerAlarm(this.name);
      }, this.entryDelay * 1000);
    } else {
      this.platform.triggerAlarm(this.name);
    }
  }
}

module.exports = Accessory;

