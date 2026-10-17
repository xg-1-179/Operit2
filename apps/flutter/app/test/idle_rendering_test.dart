import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';
import 'package:liquid_glass_widgets/widgets/shared/glass_effect.dart';
import 'package:liquid_glass_widgets/widgets/interactive/liquid_glass_scope.dart';

void main() {
  testWidgets('glass can pause capture and resume after visibility changes', (tester) async {
    final intensity = ValueNotifier<double>(0.85);
    final enabled = ValueNotifier<bool>(true);
    final color = ValueNotifier<Color>(Colors.blue);
    addTearDown(intensity.dispose);
    addTearDown(enabled.dispose);
    addTearDown(color.dispose);
    await tester.pumpWidget(MaterialApp(
      home: LiquidGlassScope(
        child: Stack(fit: StackFit.expand, children: [
          GlassBackgroundSource(child: ValueListenableBuilder<Color>(
            valueListenable: color,
            builder: (_, value, _) => ColoredBox(color: value),
          )),
          Center(child: ValueListenableBuilder<bool>(
            valueListenable: enabled,
            builder: (_, visible, _) => TickerMode(
              enabled: visible,
              child: ValueListenableBuilder<double>(
                valueListenable: intensity,
                builder: (_, value, _) => GlassEffect(
                  shape: const LiquidRoundedSuperellipse(borderRadius: 20),
                  settings: const LiquidGlassSettings(blur: 5),
                  interactionIntensity: value,
                  child: const SizedBox(width: 200, height: 80),
                ),
              ),
            ),
          )),
        ]),
      ),
    ));
    await tester.pumpAndSettle();
    for (var i = 0; i < 3; i++) {
      // Pause visibility while the gesture remains active, independently of
      // releasing the gesture. Both paths must stop requesting frames.
      enabled.value = false;
      await tester.pumpAndSettle();
      color.value = i.isEven ? Colors.red : Colors.blue;
      await tester.pumpAndSettle();
      expect(tester.binding.hasScheduledFrame, isFalse);
      enabled.value = true;
      await tester.pumpAndSettle();
      intensity.value = 0;
      await tester.pumpAndSettle();
      expect(tester.binding.hasScheduledFrame, isFalse);
      intensity.value = 0.85;
      await tester.pumpAndSettle();
      expect(tester.binding.hasScheduledFrame, isFalse);
      expect(tester.binding.transientCallbackCount, 0);
      expect(tester.takeException(), isNull);
    }
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    expect(tester.takeException(), isNull);
  });

  testWidgets('glass background updates without sustaining idle frames', (
    tester,
  ) async {
    final color = ValueNotifier<Color>(Colors.blue);
    addTearDown(color.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: LiquidGlassScope(
          child: Stack(
            fit: StackFit.expand,
            children: [
              GlassBackgroundSource(
                child: ValueListenableBuilder<Color>(
                  valueListenable: color,
                  builder: (_, value, _) => ColoredBox(color: value),
                ),
              ),
              Center(
                child: GlassEffect(
                  shape: const LiquidRoundedSuperellipse(borderRadius: 20),
                  settings: const LiquidGlassSettings(blur: 5),
                  interactionIntensity: 0.85,
                  child: const SizedBox(width: 200, height: 80),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.binding.hasScheduledFrame, isFalse);
    expect(tester.binding.transientCallbackCount, 0);
    final boundary = tester.allRenderObjects
        .whereType<GlassCaptureRenderBoundary>()
        .toSet()
        .single;
    final before = boundary.paintRevision;
    color.value = Colors.red;
    await tester.pumpAndSettle();
    expect(boundary.paintRevision, greaterThan(before));
    expect(tester.binding.hasScheduledFrame, isFalse);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    expect(tester.takeException(), isNull);
  });

}
