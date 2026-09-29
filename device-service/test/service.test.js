'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { UpsSimulator, validateConfigPatch } = require('../src/simulator');
const { createServer } = require('../src/server');
const { encodeTextFrame, decodeFrames } = require('../src/websocket');

test('config validation rejects unknown fields and bad ranges', () => {
  assert.deepStrictEqual(validateConfigPatch({ lowBatteryThreshold: 15 }), []);
  assert.strictEqual(validateConfigPatch({ lowBatteryThreshold: 99 }).length, 1);
  assert.strictEqual(validateConfigPatch({ nope: 1 }).length, 1);
  assert.strictEqual(validateConfigPatch([]).length, 1);
});

test('outage switches to battery, drains it, and raises ON_BATTERY', () => {
  const sim = new UpsSimulator({ random: () => 0.5 });
  sim.simulateOutage(3);
  const t = sim.tick();
  assert.strictEqual(t.mode, 'on_battery');
  assert.strictEqual(t.inputVoltage, 0);
  assert.ok(t.batteryPercent < 100);
  assert.ok(t.alarms.includes('ON_BATTERY'));
});

test('low battery alarm respects configured threshold', () => {
  const sim = new UpsSimulator({ random: () => 0.5 });
  sim.batteryPercent = 18;
  assert.ok(sim.tick().alarms.includes('LOW_BATTERY'));
  sim.updateConfig({ lowBatteryThreshold: 10 });
  assert.ok(!sim.tick().alarms.includes('LOW_BATTERY'));
});

test('websocket frames round-trip', () => {
  const frame = encodeTextFrame('x'.repeat(300));
  const { frames, rest } = decodeFrames(frame);
  assert.strictEqual(frames[0].payload.toString(), 'x'.repeat(300));
  assert.strictEqual(rest.length, 0);
});

test('REST API: status, config update, validation error', async () => {
  const { server } = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.ok(typeof status.batteryPercent === 'number');

    const ok = await fetch(`${base}/api/config`, { method: 'PUT', body: JSON.stringify({ overloadThreshold: 80 }) });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual((await ok.json()).overloadThreshold, 80);

    const bad = await fetch(`${base}/api/config`, { method: 'PUT', body: JSON.stringify({ overloadThreshold: 5 }) });
    assert.strictEqual(bad.status, 422);

    assert.strictEqual((await fetch(`${base}/api/unknown`)).status, 404);
  } finally {
    server.close();
  }
});
