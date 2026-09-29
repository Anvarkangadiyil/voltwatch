import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Arc gauge drawn with a single CustomPainter: two arcs and no layers,
/// images or shaders, so it stays cheap on software-rendered framebuffers.
class BatteryGauge extends StatelessWidget {
  const BatteryGauge({super.key, required this.percent, required this.color});

  final double percent;
  final Color color;

  @override
  Widget build(BuildContext context) {
    // Isolate repaints: a telemetry tick redraws only this layer.
    return RepaintBoundary(
      child: CustomPaint(
        painter: _GaugePainter(percent: percent.clamp(0, 100).toDouble(), color: color),
      ),
    );
  }
}

class _GaugePainter extends CustomPainter {
  _GaugePainter({required this.percent, required this.color});

  final double percent;
  final Color color;

  static const _start = math.pi * 0.75;
  static const _sweep = math.pi * 1.5;

  @override
  void paint(Canvas canvas, Size size) {
    final stroke = size.shortestSide * 0.09;
    final rect = Rect.fromCircle(
      center: size.center(Offset.zero),
      radius: (size.shortestSide - stroke) / 2,
    );
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;

    canvas.drawArc(rect, _start, _sweep, false, paint..color = const Color(0xFF2A3542));
    canvas.drawArc(rect, _start, _sweep * percent / 100, false, paint..color = color);
  }

  // Values arrive at 1 decimal; skip repaints when nothing visible changed.
  @override
  bool shouldRepaint(_GaugePainter old) => old.percent != percent || old.color != color;
}
