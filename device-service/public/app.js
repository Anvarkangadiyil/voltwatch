'use strict';

const $ = (id) => document.getElementById(id);
const form = $('configForm');
let reconnectDelay = 500;

function renderTelemetry(t) {
  for (const key of ['inputVoltage', 'outputVoltage', 'loadPercent', 'frequencyHz', 'temperatureC', 'batteryPercent']) {
    $(key).textContent = t[key];
  }
  $('runtime').textContent = t.runtimeMinutes;
  $('batteryFill').style.width = `${t.batteryPercent}%`;
  $('batteryFill').classList.toggle('low', t.alarms.includes('LOW_BATTERY'));
  $('selfTest').textContent = t.lastSelfTest ? t.lastSelfTest.result.toUpperCase() : 'never';

  const mode = $('mode');
  mode.textContent = t.mode.replace('_', ' ').toUpperCase();
  mode.className = `pill ${t.mode === 'online' ? 'pill--on' : 'pill--battery'}`;
  $('selfTestBtn').disabled = t.mode === 'self_test';

  const alarms = $('alarms');
  alarms.hidden = t.alarms.length === 0;
  alarms.replaceChildren(
    ...t.alarms.map((a) => Object.assign(document.createElement('span'), { className: 'alarm', textContent: a.replace('_', ' ') })),
  );
}

function renderConfig(c) {
  $('deviceName').textContent = c.deviceName;
  // Don't clobber a field the user is currently editing.
  for (const [key, value] of Object.entries(c)) {
    const input = form.elements[key];
    if (!input || input === document.activeElement) continue;
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
  }
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => {
    reconnectDelay = 500;
    $('conn').textContent = 'Live';
    $('conn').className = 'pill pill--on';
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'telemetry') renderTelemetry(msg.data);
    if (msg.type === 'config') renderConfig(msg.data);
  };
  ws.onclose = () => {
    $('conn').textContent = 'Offline';
    $('conn').className = 'pill pill--off';
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10000);
  };
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.errors || [data.error]).join(', '));
  return data;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = form.elements;
  try {
    await api('PUT', '/api/config', {
      deviceName: f.deviceName.value.trim(),
      lowBatteryThreshold: Number(f.lowBatteryThreshold.value),
      overloadThreshold: Number(f.overloadThreshold.value),
      telemetryIntervalMs: Number(f.telemetryIntervalMs.value),
      buzzerEnabled: f.buzzerEnabled.checked,
    });
    $('formMsg').textContent = 'Saved';
  } catch (err) {
    $('formMsg').textContent = err.message;
  }
});

$('selfTestBtn').addEventListener('click', () => api('POST', '/api/actions/self-test').catch((e) => alert(e.message)));
$('outageBtn').addEventListener('click', () => api('POST', '/api/actions/simulate-outage', { seconds: 20 }).catch((e) => alert(e.message)));

connect();
