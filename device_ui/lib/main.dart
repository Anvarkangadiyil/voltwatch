import 'package:flutter/material.dart';

import 'src/device_client.dart';
import 'src/home_screen.dart';

// Override at build time: flutter build ... --dart-define=DEVICE_HOST=127.0.0.1:8080
const _deviceHost = String.fromEnvironment('DEVICE_HOST', defaultValue: 'localhost:8080');

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // The UI ships no photos; cap the image cache so it can't grow on a
  // device with a few hundred MB of RAM.
  PaintingBinding.instance.imageCache.maximumSizeBytes = 8 << 20;

  final client = DeviceClient(_deviceHost)..start();
  runApp(VoltWatchApp(client: client));
}

class VoltWatchApp extends StatelessWidget {
  const VoltWatchApp({super.key, required this.client});

  final DeviceClient client;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'VoltWatch',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        colorSchemeSeed: const Color(0xFF2563EB),
        scaffoldBackgroundColor: const Color(0xFF0F1419),
        // No ink splash animations: they cost frames on low-end GPUs and
        // add nothing on a single-screen kiosk.
        splashFactory: NoSplash.splashFactory,
      ),
      home: HomeScreen(
        telemetry: client.telemetry,
        config: client.config,
        link: client.link,
        onSelfTest: client.runSelfTest,
      ),
    );
  }
}
