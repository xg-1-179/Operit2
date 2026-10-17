import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:operit_ui/operit_ui.dart';

void main() {
  Widget surface({bool grouped = false}) => ThemeGlassSurface(
    color: Colors.white,
    transparentSurface: true,
    groupBackdropFilter: grouped,
    layer: ThemeGlassSurfaceLayer.control,
    borderRadius: BorderRadius.circular(12),
    child: const SizedBox(width: 180, height: 60),
  );

  testWidgets('non-overlapping glass shares its backdrop without reducing blur', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: BackdropGroup(
      child: Column(children: [surface(grouped: true), surface(grouped: true)]),
    ))));
    final filters = find.byType(BackdropFilter);
    expect(filters, findsNWidgets(2));
    final first = tester.renderObject<RenderBackdropFilter>(filters.at(0));
    final second = tester.renderObject<RenderBackdropFilter>(filters.at(1));
    expect(first.backdropKey, isNotNull);
    expect(second.backdropKey, same(first.backdropKey));
    expect(first.filter, ui.ImageFilter.blur(sigmaX: 10, sigmaY: 10));
    expect(second.filter, first.filter);
    expect(find.byType(ClipRRect), findsNWidgets(2));
    expect(tester.takeException(), isNull);
  });

  testWidgets('overlapping glass remains independent by default', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: BackdropGroup(
      child: Stack(children: [surface(), surface()]),
    ))));
    for (final element in find.byType(BackdropFilter).evaluate()) {
      final render = element.renderObject! as RenderBackdropFilter;
      expect(render.backdropKey, isNull);
      expect(render.filter, ui.ImageFilter.blur(sigmaX: 10, sigmaY: 10));
    }
    expect(tester.takeException(), isNull);
  });
}
