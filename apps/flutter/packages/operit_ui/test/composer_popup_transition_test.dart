import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:operit_ui/operit_ui.dart';

class _BuildCounter extends StatelessWidget {
  const _BuildCounter(this.onBuild);
  final VoidCallback onBuild;

  @override
  Widget build(BuildContext context) {
    onBuild();
    return const SizedBox(width: 200, height: 100);
  }
}

void main() {
  Widget scene({
    Widget child = const SizedBox(width: 200, height: 100),
    bool disableAnimations = false,
    bool accessibleNavigation = false,
    bool alignEnd = false,
    TextDirection direction = TextDirection.ltr,
  }) => MaterialApp(
    home: MediaQuery(
      data: MediaQueryData(
        disableAnimations: disableAnimations,
        accessibleNavigation: accessibleNavigation,
      ),
      child: Directionality(
        textDirection: direction,
        child: Center(
          child: ComposerPopupTransition(
            alignEnd: alignEnd,
            child: ComposerPopupSurface(child: child),
          ),
        ),
      ),
    ),
  );

  testWidgets('entry animates without rebuilding menu content per tick', (tester) async {
    var builds = 0;
    await tester.pumpWidget(scene(child: _BuildCounter(() => builds++)));
    final initialBuilds = builds;
    final scale = tester.widget<ScaleTransition>(
      find.descendant(of: find.byType(ComposerPopupTransition), matching: find.byType(ScaleTransition)),
    ).scale;
    expect(scale.value, closeTo(0.97, 0.0001));
    await tester.pump(const Duration(milliseconds: 80));
    expect(scale.value, greaterThan(0.97));
    expect(scale.value, lessThan(1));
    expect(builds, initialBuilds);
    await tester.pumpAndSettle();
    expect(scale.value, 1);
    expect(builds, initialBuilds);
    expect(tester.binding.hasScheduledFrame, isFalse);
    expect(tester.takeException(), isNull);
  });

  for (final accessible in <bool>[false, true]) {
    testWidgets('respects ${accessible ? 'accessible navigation' : 'reduced motion'}', (tester) async {
      await tester.pumpWidget(scene(
        disableAnimations: !accessible,
        accessibleNavigation: accessible,
      ));
      final fade = tester.widget<FadeTransition>(
        find.descendant(of: find.byType(ComposerPopupTransition), matching: find.byType(FadeTransition)),
      );
      expect(fade.opacity.value, 1);
      expect(tester.binding.transientCallbackCount, 0);
    });
  }

  testWidgets('end-aligned entry resolves correctly in RTL', (tester) async {
    await tester.pumpWidget(scene(alignEnd: true, direction: TextDirection.rtl));
    final scale = tester.widget<ScaleTransition>(
      find.descendant(of: find.byType(ComposerPopupTransition), matching: find.byType(ScaleTransition)),
    );
    expect(scale.alignment, Alignment.bottomLeft);
    await tester.pumpAndSettle();
  });

  testWidgets('early dismissal releases the ticker', (tester) async {
    await tester.pumpWidget(scene());
    await tester.pump(const Duration(milliseconds: 40));
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    expect(tester.binding.transientCallbackCount, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('menu remains tappable after entry', (tester) async {
    var taps = 0;
    await tester.pumpWidget(scene(
      child: TextButton(onPressed: () => taps++, child: const Text('Action')),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Action'));
    expect(taps, 1);
  });
}
