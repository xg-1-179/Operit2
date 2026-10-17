import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:operit2/ui/common/markdown/MarkdownLatexBlock.dart';
import 'package:operit2/ui/common/markdown/MarkdownNodeGrouper.dart';
import 'package:operit2/ui/common/markdown/StreamMarkdownRenderer.dart';

void main() {
  Widget scene({
    required String text,
    List<MarkdownNodeStable> children = const <MarkdownNodeStable>[],
    bool streaming = true,
    Color color = Colors.black,
    void Function(String)? onLinkClick,
  }) => MaterialApp(
    home: Scaffold(
      body: CanvasMarkdownNodeRenderer(
        nodeKey: 'cache-regression',
        node: MarkdownNodeStable(
          type: MarkdownNodeType.plainText,
          content: text,
          isStreaming: streaming,
          children: children,
        ),
        textColor: color,
        backgroundColor: Colors.white,
        isLastNode: true,
        onLinkClick: onLinkClick,
        splitMarkdownContent: (_) async => [],
      ),
    ),
  );

  testWidgets('reveal ticks reuse inline math rather than reparse it', (tester) async {
    const children = <MarkdownNodeStable>[
      MarkdownNodeStable(type: MarkdownNodeType.plainText, content: 'Hello ', isStreaming: true),
      MarkdownNodeStable(type: MarkdownNodeType.inlineLatex, content: 'x^2', isStreaming: false),
    ];
    await tester.pumpWidget(scene(text: 'Hello x^2', children: children));
    final math = tester.widget<MarkdownInlineLatex>(find.byType(MarkdownInlineLatex));
    await tester.pump(const Duration(milliseconds: 16));
    expect(tester.widget<MarkdownInlineLatex>(find.byType(MarkdownInlineLatex)), same(math));
    await tester.pump(const Duration(milliseconds: 16));
    expect(tester.widget<MarkdownInlineLatex>(find.byType(MarkdownInlineLatex)), same(math));
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('source and color changes invalidate cached spans', (tester) async {
    await tester.pumpWidget(scene(text: 'Old text', streaming: false));
    await tester.pumpWidget(scene(text: 'Updated 👩‍💻 text', streaming: false, color: Colors.red));
    final text = tester.widgetList<Text>(find.byType(Text)).firstWhere(
      (widget) => widget.textSpan?.toPlainText().contains('Updated') ?? false,
    );
    expect(text.textSpan!.toPlainText(), 'Updated 👩‍💻 text');
    expect(text.style!.color, Colors.red);
    expect(tester.takeException(), isNull);
  });

  testWidgets('cached links use the current callback after updates', (tester) async {
    var first = 0;
    var second = 0;
    await tester.pumpWidget(scene(text: 'https://example.com', streaming: false, onLinkClick: (_) => first++));
    await tester.tap(find.byType(Text).first);
    expect(first, 1);
    await tester.pumpWidget(scene(text: 'https://example.com', streaming: false, onLinkClick: (_) => second++));
    await tester.tap(find.byType(Text).first);
    expect(first, 1);
    expect(second, 1);
    await tester.pumpWidget(const SizedBox.shrink());
    expect(tester.takeException(), isNull);
  });

  testWidgets('reveal never slices emoji or combining grapheme clusters', (tester) async {
    const clusters = <String>['\u{1f469}\u200d\u{1f4bb}', 'e\u0301', '\u{1f1e8}\u{1f1f3}'];
    final source = 'Hello ${clusters.join(' ')} world';
    Iterable<String> leaves(InlineSpan span) sync* {
      if (span is TextSpan) {
        if (span.text != null) yield span.text!;
        for (final child in span.children ?? const <InlineSpan>[]) {
          yield* leaves(child);
        }
      }
    }
    await tester.pumpWidget(scene(text: source));
    for (var tick = 0; tick < 50; tick++) {
      await tester.pump(const Duration(milliseconds: 16));
      final spans = tester.widgetList<Text>(find.byType(Text))
          .map((widget) => widget.textSpan)
          .whereType<TextSpan>();
      expect(spans, isNotEmpty);
      for (final span in spans) {
        for (final leaf in leaves(span)) {
          for (final cluster in clusters) {
            for (final rune in cluster.runes) {
              if (leaf.runes.contains(rune)) {
                // Ignore the ASCII e shared by the surrounding words.
                if (rune != 0x65) expect(leaf, contains(cluster));
              }
            }
          }
        }
      }
    }
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
