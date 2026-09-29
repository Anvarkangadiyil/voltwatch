import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import 'models.dart';

/// Talks to the local device service: WebSocket for live telemetry,
/// REST for commands. Uses dart:io directly so the embedded build carries
/// no extra packages.
class DeviceClient {
  DeviceClient(this.host);

  /// host:port of the device service, e.g. `localhost:8080`.
  final String host;

  final telemetry = ValueNotifier<Telemetry?>(null);
  final config = ValueNotifier<DeviceConfig?>(null);
  final link = ValueNotifier<LinkState>(LinkState.connecting);

  static const _minDelay = Duration(milliseconds: 500);
  static const _maxDelay = Duration(seconds: 10);

  final _http = HttpClient()..connectionTimeout = const Duration(seconds: 3);
  WebSocket? _socket;
  Timer? _retry;
  Duration _delay = _minDelay;
  bool _disposed = false;

  void start() => _connect();

  Future<void> _connect() async {
    if (_disposed) return;
    link.value = LinkState.connecting;
    try {
      final socket = await WebSocket.connect('ws://$host/ws').timeout(const Duration(seconds: 5));
      if (_disposed) {
        await socket.close();
        return;
      }
      _socket = socket..pingInterval = const Duration(seconds: 10);
      _delay = _minDelay;
      link.value = LinkState.live;
      socket.listen(
        _onMessage,
        onDone: _scheduleReconnect,
        onError: (Object _) => _scheduleReconnect(),
        cancelOnError: true,
      );
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _onMessage(dynamic raw) {
    final msg = jsonDecode(raw as String) as Map<String, dynamic>;
    final data = msg['data'] as Map<String, dynamic>;
    switch (msg['type']) {
      case 'telemetry':
        telemetry.value = Telemetry.fromJson(data);
      case 'config':
        config.value = DeviceConfig.fromJson(data);
    }
  }

  // Exponential backoff so a crashed service doesn't get hammered and the
  // UI thread stays idle while the device is disconnected.
  void _scheduleReconnect() {
    if (_disposed) return;
    _socket = null;
    link.value = LinkState.offline;
    _retry?.cancel();
    _retry = Timer(_delay, _connect);
    _delay = Duration(milliseconds: math.min(_delay.inMilliseconds * 2, _maxDelay.inMilliseconds));
  }

  /// Starts a battery self-test. Returns a short message for the UI.
  Future<String> runSelfTest() async {
    try {
      final req = await _http.postUrl(Uri.parse('http://$host/api/actions/self-test'));
      final res = await req.close();
      await res.drain<void>();
      return switch (res.statusCode) {
        202 => 'Self-test started',
        409 => 'Self-test already running',
        _ => 'Self-test failed (${res.statusCode})',
      };
    } on Exception {
      return 'Device service unreachable';
    }
  }

  void dispose() {
    _disposed = true;
    _retry?.cancel();
    _socket?.close();
    _http.close(force: true);
    telemetry.dispose();
    config.dispose();
    link.dispose();
  }
}
