import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:liquid_glass_widgets/widgets/shared/glass_effect.dart';
import 'package:operit_ui/operit_ui.dart';

void main() {
  Widget scene({bool reduceMotion = false, bool highContrast = false}) =>
      MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(
            disableAnimations: reduceMotion,
            highContrast: highContrast,
          ),
          child: Scaffold(
            body: Center(
              child: AgentInputSurface(
                color: Colors.white,
                floating: true,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(22),
                ),
                borderRadius: BorderRadius.circular(22),
                width: 300,
                margin: EdgeInsets.zero,
                transparentSurface: true,
                child: const SizedBox(height: 100),
              ),
            ),
          ),
        ),
      );

  testWidgets('glass samples only while pressed and returns to rest', (tester) async {
    await tester.pumpWidget(scene());
    expect(tester.widget<GlassEffect>(find.byType(GlassEffect)).interactionIntensity, 0);
    final gesture = await tester.startGesture(tester.getCenter(find.byType(AgentInputSurface)));
    await tester.pump();
    expect(tester.widget<GlassEffect>(find.byType(GlassEffect)).interactionIntensity, 0.6);
    await gesture.up();
    await tester.pumpAndSettle();
    expect(tester.widget<GlassEffect>(find.byType(GlassEffect)).interactionIntensity, 0);
    expect(tester.widget<AnimatedScale>(find.byType(AnimatedScale)).scale, 1);
  });

  testWidgets('reduced motion disables deformation and active capture', (tester) async {
    await tester.pumpWidget(scene(reduceMotion: true));
    final gesture = await tester.startGesture(tester.getCenter(find.byType(AgentInputSurface)));
    await tester.pump();
    expect(tester.widget<GlassEffect>(find.byType(GlassEffect)).interactionIntensity, 0);
    expect(tester.widget<AnimatedScale>(find.byType(AnimatedScale)).scale, 1);
    await gesture.cancel();
    await tester.pumpAndSettle();
  });

  testWidgets('high contrast removes glass and backdrop filters', (tester) async {
    await tester.pumpWidget(scene(highContrast: true));
    expect(find.byType(GlassEffect), findsNothing);
    expect(find.byType(BackdropFilter), findsNothing);
  });

  testWidgets('glass stays pressed until the final pointer releases', (tester) async {
    await tester.pumpWidget(scene());
    final center = tester.getCenter(find.byType(AgentInputSurface));
    final first = await tester.startGesture(center, pointer: 1);
    await tester.pump();
    final second = await tester.startGesture(center + const Offset(20, 0), pointer: 2);
    await tester.pump();
    await first.up();
    await tester.pump();
    expect(tester.widget<GlassEffect>(find.byType(GlassEffect)).interactionIntensity, 0.6);
    await second.cancel();
    await tester.pumpAndSettle();
    expect(tester.widget<GlassEffect>(find.byType(GlassEffect)).interactionIntensity, 0);
    expect(tester.widget<AnimatedScale>(find.byType(AnimatedScale)).scale, 1);
  });

  testWidgets('rim animates without replacing its paint delegate each frame', (tester) async {
    await tester.pumpWidget(scene());
    await tester.pumpAndSettle();
    final rim = find.descendant(
      of: find.byType(AgentInputSurface),
      matching: find.byWidgetPredicate((widget) =>
          widget is CustomPaint &&
          widget.painter.runtimeType.toString() == '_InputGlassRimPainter'),
    );
    expect(rim, findsOneWidget);
    final gesture = await tester.startGesture(
      tester.getCenter(find.byType(AgentInputSurface)),
    );
    await tester.pump();
    final painter = tester.widget<CustomPaint>(rim).painter!;
    final progress = (painter as dynamic).progress as Animation<double>;
    final initial = progress.value;
    await tester.pump(const Duration(milliseconds: 60));
    expect(progress.value, greaterThan(initial));
    expect(tester.widget<CustomPaint>(rim).painter, same(painter));
    await tester.pump(const Duration(milliseconds: 60));
    expect(tester.widget<CustomPaint>(rim).painter, same(painter));
    await gesture.up();
    await tester.pumpAndSettle();
    expect(tester.binding.hasScheduledFrame, isFalse);
    expect(tester.binding.transientCallbackCount, 0);
    expect(tester.takeException(), isNull);
  });
}
