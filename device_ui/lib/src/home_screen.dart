import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'battery_gauge.dart';
import 'models.dart';

const _ok = Color(0xFF2FB36A);
const _warn = Color(0xFFE0A030);
const _bad = Color(0xFFE5484D);
const _muted = Color(0xFF8B9AA9);
const _panel = Color(0xFF19212A);

/// Single-screen kiosk layout sized for an 800x480 panel. Each region
/// listens to only the notifier it needs, so a telemetry tick rebuilds the
/// data widgets and leaves the header and buttons alone.
class HomeScreen extends StatelessWidget {
  const HomeScreen({
    super.key,
    required this.telemetry,
    required this.config,
    required this.link,
    required this.onSelfTest,
  });

  final ValueListenable<Telemetry?> telemetry;
  final ValueListenable<DeviceConfig?> config;
  final ValueListenable<LinkState> link;
  final Future<String> Function() onSelfTest;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              _Header(config: config, link: link),
              const SizedBox(height: 12),
              Expanded(
                child: ValueListenableBuilder<Telemetry?>(
                  valueListenable: telemetry,
                  builder: (context, t, _) => t == null ? const _Waiting() : _Dashboard(t: t),
                ),
              ),
              const SizedBox(height: 12),
              _Footer(telemetry: telemetry, onSelfTest: onSelfTest),
            ],
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.config, required this.link});

  final ValueListenable<DeviceConfig?> config;
  final ValueListenable<LinkState> link;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        ValueListenableBuilder<DeviceConfig?>(
          valueListenable: config,
          builder: (_, c, _) => Text(c?.deviceName ?? 'VoltWatch', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600)),
        ),
        const Spacer(),
        ValueListenableBuilder<LinkState>(
          valueListenable: link,
          builder: (_, state, _) => _Pill(
            label: switch (state) {
              LinkState.live => 'LIVE',
              LinkState.connecting => 'CONNECTING',
              LinkState.offline => 'OFFLINE',
            },
            color: state == LinkState.live ? _ok : _bad,
          ),
        ),
      ],
    );
  }
}

class _Waiting extends StatelessWidget {
  const _Waiting();

  @override
  Widget build(BuildContext context) =>
      const Center(child: Text('Waiting for device...', style: TextStyle(fontSize: 20, color: _muted)));
}

class _Dashboard extends StatelessWidget {
  const _Dashboard({required this.t});

  final Telemetry t;

  @override
  Widget build(BuildContext context) {
    final batteryColor = t.lowBattery ? _bad : (t.onBattery ? _warn : _ok);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          flex: 4,
          child: Stack(
            alignment: Alignment.center,
            children: [
              Positioned.fill(child: BatteryGauge(percent: t.batteryPercent, color: batteryColor)),
              Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('${t.batteryPercent.round()}%', style: const TextStyle(fontSize: 56, fontWeight: FontWeight.w700)),
                  Text('${t.runtimeMinutes} min runtime', style: const TextStyle(fontSize: 16, color: _muted)),
                  const SizedBox(height: 6),
                  _Pill(label: t.mode.replaceAll('_', ' ').toUpperCase(), color: t.onBattery ? _warn : _ok),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          flex: 5,
          child: GridView.count(
            crossAxisCount: 2,
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 1.9,
            physics: const NeverScrollableScrollPhysics(),
            children: [
              _Metric('Input', '${t.inputVoltage.toStringAsFixed(0)} V', alert: t.inputVoltage == 0),
              _Metric('Output', '${t.outputVoltage.toStringAsFixed(0)} V'),
              _Metric('Load', '${t.loadPercent.toStringAsFixed(0)} %', alert: t.alarms.contains('OVERLOAD')),
              _Metric('Frequency', '${t.frequencyHz.toStringAsFixed(1)} Hz'),
              _Metric('Temp', '${t.temperatureC.toStringAsFixed(1)} °C', alert: t.alarms.contains('OVER_TEMPERATURE')),
              _Metric('Self-test', t.lastSelfTestResult?.toUpperCase() ?? '--'),
            ],
          ),
        ),
      ],
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric(this.label, this.value, {this.alert = false});

  final String label;
  final String value;
  final bool alert;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: _panel,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: alert ? _bad : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(label, style: const TextStyle(fontSize: 14, color: _muted)),
            Text(
              value,
              style: TextStyle(fontSize: 26, fontWeight: FontWeight.w600, color: alert ? _bad : null),
              maxLines: 1,
            ),
          ],
        ),
      ),
    );
  }
}

class _Footer extends StatefulWidget {
  const _Footer({required this.telemetry, required this.onSelfTest});

  final ValueListenable<Telemetry?> telemetry;
  final Future<String> Function() onSelfTest;

  @override
  State<_Footer> createState() => _FooterState();
}

class _FooterState extends State<_Footer> {
  String? _message;

  Future<void> _selfTest() async {
    final msg = await widget.onSelfTest();
    if (mounted) setState(() => _message = msg);
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 56,
      child: Row(
        children: [
          Expanded(
            child: ValueListenableBuilder<Telemetry?>(
              valueListenable: widget.telemetry,
              builder: (_, t, _) {
                final alarms = t?.alarms ?? const <String>[];
                if (alarms.isEmpty) {
                  return Text(_message ?? 'No active alarms', style: const TextStyle(fontSize: 16, color: _muted));
                }
                return Wrap(
                  spacing: 8,
                  children: [for (final a in alarms) _Pill(label: a.replaceAll('_', ' '), color: _bad)],
                );
              },
            ),
          ),
          // Large touch target for resistive panels and gloved hands.
          SizedBox(
            height: 56,
            child: FilledButton(
              onPressed: _selfTest,
              child: const Text('SELF-TEST', style: TextStyle(fontSize: 18)),
            ),
          ),
        ],
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(999)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        child: Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Colors.white)),
      ),
    );
  }
}
