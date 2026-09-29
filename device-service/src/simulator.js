'use strict';

const { EventEmitter } = require('node:events');

const DEFAULT_CONFIG = Object.freeze({
  deviceName: 'VoltWatch UPS-1500',
  lowBatteryThreshold: 20, // % battery that raises LOW_BATTERY
  overloadThreshold: 90, // % load that raises OVERLOAD
  telemetryIntervalMs: 1000,
  buzzerEnabled: true,
});

// Rules for PUT /api/config. Each entry returns an error string or null.
const CONFIG_RULES = {
  deviceName: (v) => (typeof v === 'string' && v.trim().length >= 1 && v.length <= 32 ? null : 'must be a 1-32 char string'),
  lowBatteryThreshold: (v) => (Number.isInteger(v) && v >= 5 && v <= 50 ? null : 'must be an integer 5-50'),
  overloadThreshold: (v) => (Number.isInteger(v) && v >= 50 && v <= 100 ? null : 'must be an integer 50-100'),
  telemetryIntervalMs: (v) => (Number.isInteger(v) && v >= 250 && v <= 10000 ? null : 'must be an integer 250-10000'),
  buzzerEnabled: (v) => (typeof v === 'boolean' ? null : 'must be a boolean'),
};

function validateConfigPatch(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return ['body must be a JSON object'];
  }
  const errors = [];
  for (const [key, value] of Object.entries(patch)) {
    const rule = CONFIG_RULES[key];
    if (!rule) {
      errors.push(`${key}: unknown field`);
      continue;
    }
    const err = rule(value);
    if (err) errors.push(`${key}: ${err}`);
  }
  return errors;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;

/**
 * Simulates a line-interactive UPS. Emits 'telemetry' on every tick and
 * 'config' whenever the configuration changes.
 */
class UpsSimulator extends EventEmitter {
  constructor({ config = {}, random = Math.random } = {}) {
    super();
    this.random = random;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.batteryPercent = 100;
    this.loadPercent = 35;
    this.temperatureC = 31;
    this.outageTicksLeft = 0;
    this.selfTestTicksLeft = 0;
    this.lastSelfTest = null;
    this.timer = null;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.emit('telemetry', this.tick()), this.config.telemetryIntervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  updateConfig(patch) {
    const errors = validateConfigPatch(patch);
    if (errors.length) return { ok: false, errors };
    const intervalChanged = patch.telemetryIntervalMs !== undefined && patch.telemetryIntervalMs !== this.config.telemetryIntervalMs;
    this.config = { ...this.config, ...patch };
    if (intervalChanged && this.timer) this.start();
    this.emit('config', this.config);
    return { ok: true, config: this.config };
  }

  simulateOutage(seconds) {
    const ticks = Math.ceil((seconds * 1000) / this.config.telemetryIntervalMs);
    this.outageTicksLeft = Math.max(this.outageTicksLeft, ticks);
  }

  startSelfTest() {
    if (this.selfTestTicksLeft > 0) return false;
    this.selfTestTicksLeft = Math.ceil(5000 / this.config.telemetryIntervalMs);
    return true;
  }

  get mode() {
    if (this.selfTestTicksLeft > 0) return 'self_test';
    if (this.outageTicksLeft > 0) return 'on_battery';
    return 'online';
  }

  /** Advances the simulation by one interval and returns a telemetry snapshot. */
  tick() {
    const jitter = (amp) => (this.random() - 0.5) * 2 * amp;
    const onBattery = this.outageTicksLeft > 0 || this.selfTestTicksLeft > 0;

    this.loadPercent = clamp(this.loadPercent + jitter(2), 5, 100);
    this.temperatureC = clamp(this.temperatureC + jitter(0.2) + (onBattery ? 0.05 : -0.02), 25, 55);

    if (onBattery) {
      // Drain faster under heavier load.
      this.batteryPercent = clamp(this.batteryPercent - 0.2 - this.loadPercent / 250, 0, 100);
    } else {
      this.batteryPercent = clamp(this.batteryPercent + 0.3, 0, 100);
    }

    if (this.outageTicksLeft > 0) this.outageTicksLeft -= 1;
    if (this.selfTestTicksLeft > 0) {
      this.selfTestTicksLeft -= 1;
      if (this.selfTestTicksLeft === 0) {
        this.lastSelfTest = { at: new Date().toISOString(), result: this.batteryPercent > 30 ? 'pass' : 'fail' };
      }
    }

    const inputVoltage = this.outageTicksLeft > 0 ? 0 : 230 + jitter(4);
    // Simple runtime model: 1500 VA pack gives ~60 min at 25% load.
    const runtimeMinutes = (this.batteryPercent / 100) * (60 * 25) / Math.max(this.loadPercent, 5);

    const alarms = [];
    if (this.outageTicksLeft > 0) alarms.push('ON_BATTERY');
    if (this.batteryPercent < this.config.lowBatteryThreshold) alarms.push('LOW_BATTERY');
    if (this.loadPercent > this.config.overloadThreshold) alarms.push('OVERLOAD');
    if (this.temperatureC > 45) alarms.push('OVER_TEMPERATURE');

    return {
      timestamp: new Date().toISOString(),
      mode: this.mode,
      inputVoltage: round1(inputVoltage),
      outputVoltage: round1(230 + jitter(1)),
      frequencyHz: round1(50 + jitter(0.1)),
      loadPercent: round1(this.loadPercent),
      batteryPercent: round1(this.batteryPercent),
      runtimeMinutes: Math.round(runtimeMinutes),
      temperatureC: round1(this.temperatureC),
      alarms,
      lastSelfTest: this.lastSelfTest,
    };
  }
}

module.exports = { UpsSimulator, DEFAULT_CONFIG, validateConfigPatch };
