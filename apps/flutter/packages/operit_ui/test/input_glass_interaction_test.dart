import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:liquid_glass_widgets/widgets/shared/glass_effect.dart';
import 'package:operit_ui/operit_ui.dart';

void main() {
  testWidgets('transparent cards retain blur and the original translucency', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: ThemeGlassSurface(
        color: Colors.white,
        transparentSurface: true,
        child: SizedBox(width: 200, height: 80),
      ),
    ));
    expect(find.byType(BackdropFilter), findsOneWidget);
    final decoration = tester.widgetList<DecoratedBox>(find.byType(DecoratedBox))
        .map((widget) => widget.decoration)
        .whereType<BoxDecoration>()
        .firstWhere((decoration) => decoration.color != null);
    expect(decoration.color!.a, closeTo(0.16, 0.005));
    expect(tester.takeException(), isNull);
  });

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
    final animation = tester.widget<GlassEffect>(find.byType(GlassEffect)).interactionAnimation!;
    expect(animation.value, 0);
    await tester.pump(const Duration(milliseconds: 60));
    expect(animation.value, inExclusiveRange(0, 0.6));
    await tester.pump(const Duration(milliseconds: 150));
    expect(animation.value, closeTo(0.6, 0.0001));
    await gesture.up();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 60));
    expect(animation.value, inExclusiveRange(0, 0.6));
    await tester.pumpAndSettle();
    expect(animation.value, 0);
    expect(tester.widget<GlassEffect>(find.byType(GlassEffect)).interactionIntensity, 0);
    expect(tester.widget<GlassEffect>(find.byType(GlassEffect)).interactionAnimation!.value, 0);
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

  testWidgets('refraction ticks retain the input subtree and stop on disposal', (tester) async {
    await tester.pumpWidget(scene());
    await tester.pumpAndSettle();
    final gesture = await tester.startGesture(
      tester.getCenter(find.byType(AgentInputSurface)),
    );
    await tester.pump();
    final glass = tester.widget<GlassEffect>(find.byType(GlassEffect));
    final animation = glass.interactionAnimation!;
    await tester.pump(const Duration(milliseconds: 60));
    expect(animation.value, greaterThan(0));
    expect(tester.widget<GlassEffect>(find.byType(GlassEffect)), same(glass));
    await tester.pumpWidget(const SizedBox.shrink());
    await gesture.cancel();
    await tester.pumpAndSettle();
    expect(tester.binding.transientCallbackCount, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('interrupted press and release continue from the current refraction', (tester) async {
    await tester.pumpWidget(scene());
    await tester.pumpAndSettle();
    final center = tester.getCenter(find.byType(AgentInputSurface));
    final first = await tester.startGesture(center);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    final animation = tester.widget<GlassEffect>(find.byType(GlassEffect)).interactionAnimation!;
    final pressedValue = animation.value;
    await first.up();
    await tester.pump();
    expect(animation.value, closeTo(pressedValue, 0.0001));
    await tester.pump(const Duration(milliseconds: 20));
    expect(animation.value, lessThan(pressedValue));
    final releasedValue = animation.value;
    final second = await tester.startGesture(center);
    await tester.pump();
    expect(animation.value, closeTo(releasedValue, 0.0001));
    await tester.pump(const Duration(milliseconds: 20));
    expect(animation.value, greaterThan(releasedValue));
    await second.up();
    await tester.pumpAndSettle();
    expect(animation.value, 0);
    expect(tester.binding.transientCallbackCount, 0);
    expect(tester.takeException(), isNull);
  });
}
