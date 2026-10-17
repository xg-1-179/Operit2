import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:operit_ui/operit_ui.dart';

void main() {
  Widget scene({
    VoidCallback? onTap,
    bool disableAnimations = false,
  }) => MaterialApp(
    home: MediaQuery(
      data: MediaQueryData(disableAnimations: disableAnimations),
      child: Scaffold(
        body: Center(
          child: ThemeComposerIconTarget(
            icon: Icons.add,
            color: Colors.black,
            tooltip: 'Attach',
            onTap: onTap,
          ),
        ),
      ),
    ),
  );

  testWidgets('press scales without changing layout and release keeps tap', (tester) async {
    var taps = 0;
    await tester.pumpWidget(scene(onTap: () => taps++));
    final target = find.byType(ThemeComposerIconTarget);
    final bounds = tester.getRect(target);
    final pointer = await tester.startGesture(bounds.center);
    await tester.pump();
    expect(tester.widget<AnimatedScale>(find.byType(AnimatedScale)).scale, 0.94);
    await tester.pump(const Duration(milliseconds: 60));
    expect(tester.getRect(target), bounds);
    await pointer.up();
    await tester.pumpAndSettle();
    expect(taps, 1);
    expect(tester.widget<AnimatedScale>(find.byType(AnimatedScale)).scale, 1);
    expect(tester.binding.hasScheduledFrame, isFalse);
  });

  testWidgets('multi-touch cancellation holds until the final pointer', (tester) async {
    await tester.pumpWidget(scene(onTap: () {}));
    final center = tester.getCenter(find.byType(ThemeComposerIconTarget));
    final first = await tester.startGesture(center, pointer: 1);
    final second = await tester.startGesture(center, pointer: 2);
    await tester.pump();
    await first.cancel();
    await tester.pump();
    expect(tester.widget<AnimatedScale>(find.byType(AnimatedScale)).scale, 0.94);
    await second.cancel();
    await tester.pumpAndSettle();
    expect(tester.widget<AnimatedScale>(find.byType(AnimatedScale)).scale, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('disabled controls remain unpressed', (tester) async {
    await tester.pumpWidget(scene());
    final pointer = await tester.startGesture(
      tester.getCenter(find.byType(ThemeComposerIconTarget)),
    );
    await tester.pump();
    expect(tester.widget<AnimatedScale>(find.byType(AnimatedScale)).scale, 1);
    await pointer.cancel();
  });

  testWidgets('reduced motion settles immediately and disposal is safe', (tester) async {
    await tester.pumpWidget(scene(onTap: () {}, disableAnimations: true));
    final pointer = await tester.startGesture(
      tester.getCenter(find.byType(ThemeComposerIconTarget)),
    );
    await tester.pumpAndSettle();
    expect(tester.widget<AnimatedScale>(find.byType(AnimatedScale)).duration, Duration.zero);
    await tester.pumpWidget(const SizedBox.shrink());
    await pointer.cancel();
    await tester.pumpAndSettle();
    expect(tester.binding.transientCallbackCount, 0);
    expect(tester.takeException(), isNull);
  });
}
