/// Snapshot pushed by the device service over WebSocket once per interval.
class Telemetry {
  const Telemetry({
    required this.mode,
    required this.inputVoltage,
    required this.outputVoltage,
    required this.frequencyHz,
    required this.loadPercent,
    required this.batteryPercent,
    required this.runtimeMinutes,
    required this.temperatureC,
    required this.alarms,
    this.lastSelfTestResult,
  });

  factory Telemetry.fromJson(Map<String, dynamic> json) => Telemetry(
        mode: json['mode'] as String,
        inputVoltage: (json['inputVoltage'] as num).toDouble(),
        outputVoltage: (json['outputVoltage'] as num).toDouble(),
        frequencyHz: (json['frequencyHz'] as num).toDouble(),
        loadPercent: (json['loadPercent'] as num).toDouble(),
        batteryPercent: (json['batteryPercent'] as num).toDouble(),
        runtimeMinutes: (json['runtimeMinutes'] as num).toInt(),
        temperatureC: (json['temperatureC'] as num).toDouble(),
        alarms: List<String>.from(json['alarms'] as List),
        lastSelfTestResult: (json['lastSelfTest'] as Map<String, dynamic>?)?['result'] as String?,
      );

  final String mode; // online | on_battery | self_test
  final double inputVoltage;
  final double outputVoltage;
  final double frequencyHz;
  final double loadPercent;
  final double batteryPercent;
  final int runtimeMinutes;
  final double temperatureC;
  final List<String> alarms;
  final String? lastSelfTestResult;

  bool get onBattery => mode != 'online';
  bool get lowBattery => alarms.contains('LOW_BATTERY');
}

class DeviceConfig {
  const DeviceConfig({required this.deviceName, required this.lowBatteryThreshold});

  factory DeviceConfig.fromJson(Map<String, dynamic> json) => DeviceConfig(
        deviceName: json['deviceName'] as String,
        lowBatteryThreshold: (json['lowBatteryThreshold'] as num).toInt(),
      );

  final String deviceName;
  final int lowBatteryThreshold;
}

enum LinkState { connecting, live, offline }
