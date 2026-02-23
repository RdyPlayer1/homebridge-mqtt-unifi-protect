let Service, Characteristic;

class Accessory {
  constructor(platform, name, mac, config) {
    this.platform = platform;
    this.log = platform.log;
    this.name = name;
    this.mac = mac;
    this.config = config;

    Service = platform.api.hap.Service;
    Characteristic = platform.api.hap.Characteristic;

    this.service = new Service(config.type === 'motion' ? Service.MotionSensor : Service.ContactSensor, name);

    this.isArmedHome = config.armHome || false;
    this.isArmedAway = config.armAway || false;
    this.monitorOff = config.monitorOff || false;
    this.entryDelay = config.entryDelay || 0;
  }

  handleMessage(value) {
    const systemState = this.getSystemState();
    let shouldAlert = false;

    if (systemState === 'home') shouldAlert = this.isArmedHome;
    else if (systemState === 'away') shouldAlert = this.isArmedAway;
    else if (systemState === 'off') shouldAlert = this.monitorOff;

    if (shouldAlert) {
      const HAP = Characteristic;

      if (this.config.type === 'motion') {
        this.service.setCharacteristic(HAP.MotionDetected, value === 'true');
      } else {
        this.service.setCharacteristic(HAP.ContactSensorState, value === 'true' ? HAP.ContactSensorState.CONTACT_NOT_DETECTED : HAP.ContactSensorState.CONTACT_DETECTED);
      }

      this.log(`${this.name} triggered!`);

      // Trigger alarm after entry delay
      setTimeout(() => {
        this.platform.triggerAlarm(HAP.SecuritySystemCurrentState.AWAY_ARM);
      }, this.entryDelay * 1000);
    }
  }

  getSystemState() {
    const alarm = this.platform.accessories.find(a => a.getService(Service.SecuritySystem));
    if (!alarm) return 'off';

    const service = alarm.getService(Service.SecuritySystem);
    const HAP = Characteristic;
    const state = service.getCharacteristic(HAP.SecuritySystemCurrentState).value;

    switch(state) {
      case HAP.SecuritySystemCurrentState.DISARMED: return 'off';
      case HAP.SecuritySystemCurrentState.AWAY_ARM: return 'away';
      case HAP.SecuritySystemCurrentState.STAY_ARM: return 'home';
      default: return 'off';
    }
  }
}

module.exports = Accessory;
