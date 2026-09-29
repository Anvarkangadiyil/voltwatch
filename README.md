# VoltWatch

A UPS (uninterruptible power supply) monitor built the way small embedded Linux products are built:

- a **device service** that owns the hardware and exposes it over REST and WebSocket,
- an **on-device kiosk UI** in Flutter for an 800x480 touch panel,
- a **web dashboard** served by the device for remote monitoring and configuration.

The hardware is simulated, so the whole stack runs on a laptop. The same code targets a Raspberry Pi class board.

```
┌──────────────────────── device (embedded Linux) ─────────────────────────┐
│                                                                          │
│  ┌──────────────────────┐   WebSocket /ws (1 Hz push)  ┌───────────────┐ │
│  │ Flutter kiosk UI     │◄─────────────────────────────┤ device-service│ │
│  │ flutter-pi, DRM/KMS  │   REST /api/actions/*        │ Node.js, no   │ │
│  │ 800x480 touch panel  ├─────────────────────────────►│ dependencies  │ │
│  └──────────────────────┘                              │               │ │
│                                                        │ UPS simulator │ │
└────────────────────────────────────────────────────────┤ (stands in    │─┘
                                                         │ for the HW)   │
          ┌───────────────────────────┐   HTTP + WS      └───────▲───────┘
          │ Web dashboard (browser)   │◄─────────────────────────┘
          │ vanilla HTML/CSS/JS, 12KB │
          └───────────────────────────┘
```

## Run it

```bash
# 1. Device service + web dashboard  ->  http://localhost:8080
cd device-service
npm start

# 2. Kiosk UI (desktop window sized 800x480)
cd device_ui
flutter run -d windows        # or -d linux
# pointing at another host:
flutter run -d linux --dart-define=DEVICE_HOST=192.168.1.40:8080
```

Click **Simulate 20 s outage** on the dashboard to watch both UIs switch to battery mode, raise alarms, and recover.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | uptime, connected clients |
| GET | `/api/status` | latest telemetry snapshot |
| GET / PUT | `/api/config` | thresholds, device name, telemetry interval. PUT is validated field by field (422 with errors) |
| POST | `/api/actions/self-test` | 202 started, 409 if already running |
| POST | `/api/actions/simulate-outage` | `{ "seconds": 20 }` |
| WS | `/ws` | pushes `{type: "telemetry" \| "config", data}`; sends current state on connect |

## Design choices for constrained hardware

**Kiosk UI (Flutter)**
- One screen, no navigation stack, no page or ink-splash animations.
- Each region listens only to the `ValueNotifier` it needs, so a telemetry tick rebuilds the data widgets and nothing else.
- Battery gauge is a single `CustomPainter` inside a `RepaintBoundary`, with `shouldRepaint` skipping frames when the value didn't change.
- No third-party packages: networking uses `dart:io` `WebSocket` and `HttpClient`. Image cache capped at 8 MB.
- WebSocket reconnect uses exponential backoff (0.5 s to 10 s) and shows LIVE / CONNECTING / OFFLINE, so a restarting service never leaves a frozen screen.
- 56 px touch targets for resistive panels.

**Device service (Node.js)**
- Zero npm dependencies. The WebSocket layer (`src/websocket.js`) is a small RFC 6455 implementation: handshake, text frames out, masked frames in, ping/pong.
- Request bodies capped at 4 KB, static file serving guarded against path traversal.
- systemd unit caps memory at 96 MB and runs with `ProtectSystem=strict`.

**Web dashboard**
- Plain HTML, CSS and JS, about 12 KB uncompressed, no build step, so it can be served from the device's own flash.
- Responsive grid down to phone width, dark mode via `prefers-color-scheme`.
- Doesn't overwrite a config field while the user is typing in it.

## Deploying to a Raspberry Pi (embedded target)

The kiosk runs under [flutter-pi](https://github.com/ardera/flutter-pi), which renders straight to the display through DRM/KMS, with no X11 or Wayland compositor on the device.

```bash
# On the dev machine: cross-compile the Flutter bundle for arm64
dart pub global activate flutterpi_tool
cd device_ui
flutterpi_tool build --arch=arm64 --release \
  --dart-define=DEVICE_HOST=127.0.0.1:8080

# Copy to the Pi
rsync -a build/flutter-pi/ pi@<ip>:/opt/voltwatch/ui/
rsync -a ../device-service/ pi@<ip>:/opt/voltwatch/device-service/ --exclude node_modules

# On the Pi
sudo useradd -r -G video,input,render voltwatch
sudo cp deploy/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now voltwatch-device voltwatch-ui
```

Useful checks on the device:

```bash
systemctl status voltwatch-ui           # service state and restarts
journalctl -u voltwatch-device -f       # live service logs
grep VmRSS /proc/$(pgrep flutter-pi)/status   # UI resident memory
top -p $(pgrep -d, -f 'flutter-pi|node')      # CPU per process
```

## Tests

```bash
cd device-service && npm test     # simulator rules, config validation, WS framing, REST API
cd device_ui && flutter test      # payload parsing, 800x480 layout with no overflow, alarms, self-test action
```

## Layout

```
device-service/   Node service, UPS simulator, web dashboard (public/)
device_ui/        Flutter kiosk app (lib/src/)
deploy/           systemd units
```
