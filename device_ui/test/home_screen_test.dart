import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voltwatch_ui/src/home_screen.dart';
import 'package:voltwatch_ui/src/models.dart';

Map<String, dynamic> _json({String mode = 'online', double battery = 82, List<String> alarms = const []}) => {
      'mode': mode,
      'inputVoltage': mode == 'on_battery' ? 0 : 231.2,
      'outputVoltage': 229.8,
      'frequencyHz': 50.0,
      'loadPercent': 41.3,
      'batteryPercent': battery,
      'runtimeMinutes': 30,
      'temperatureC': 32.1,
      'alarms': alarms,
      'lastSelfTest': {'at': '2026-09-29T10:00:00Z', 'result': 'pass'},
    };

void main() {
  test('Telemetry.fromJson parses the device payload', () {
    final t = Telemetry.fromJson(_json(alarms: ['LOW_BATTERY']));
    expect(t.batteryPercent, 82);
    expect(t.lowBattery, isTrue);
    expect(t.onBattery, isFalse);
    expect(t.lastSelfTestResult, 'pass');
  });

  testWidgets('renders telemetry and alarms at 800x480', (tester) async {
    tester.view.physicalSize = const Size(800, 480);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final telemetry = ValueNotifier<Telemetry?>(null);
    final link = ValueNotifier(LinkState.connecting);
    var selfTests = 0;

    await tester.pumpWidget(MaterialApp(
      theme: ThemeData.dark(),
      home: HomeScreen(
        telemetry: telemetry,
        config: ValueNotifier(const DeviceConfig(deviceName: 'Rack UPS', lowBatteryThreshold: 20)),
        link: link,
        onSelfTest: () async {
          selfTests++;
          return 'Self-test started';
        },
      ),
    ));

    expect(find.text('Waiting for device...'), findsOneWidget);
    expect(find.text('CONNECTING'), findsOneWidget);

    link.value = LinkState.live;
    telemetry.value = Telemetry.fromJson(_json(mode: 'on_battery', battery: 15, alarms: ['ON_BATTERY', 'LOW_BATTERY']));
    await tester.pump();

    expect(find.text('Rack UPS'), findsOneWidget);
    expect(find.text('LIVE'), findsOneWidget);
    expect(find.text('15%'), findsOneWidget);
    expect(find.text('ON BATTERY'), findsWidgets);
    expect(find.text('LOW BATTERY'), findsOneWidget);
    expect(tester.takeException(), isNull); // no layout overflow at 800x480

    await tester.tap(find.text('SELF-TEST'));
    await tester.pump();
    expect(selfTests, 1);
  });
}
