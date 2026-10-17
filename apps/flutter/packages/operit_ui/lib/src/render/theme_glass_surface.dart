import 'dart:ui' as ui;

import 'package:flutter/material.dart';

enum ThemeGlassSurfaceLayer { panel, card, control }

class ThemeGlassSurface extends StatelessWidget {
  const ThemeGlassSurface({
    super.key,
    required this.child,
    required this.color,
    required this.transparentSurface,
    this.borderRadius = BorderRadius.zero,
    this.border,
    this.shadows = const <BoxShadow>[],
    this.layer = ThemeGlassSurfaceLayer.card,
    this.transparentAlpha,
    this.material = false,
    this.enableBackdropFilter = true,
    this.groupBackdropFilter = false,
    this.clip = true,
  });

  final Widget child;
  final Color color;
  final bool transparentSurface;
  final BorderRadius borderRadius;
  final BoxBorder? border;
  final List<BoxShadow> shadows;
  final ThemeGlassSurfaceLayer layer;
  final double? transparentAlpha;
  final bool material;

  /// Keeps translucent styling without paying for a per-surface blur pass.
  final bool enableBackdropFilter;

  /// Opts non-overlapping siblings into their local BackdropGroup.
  final bool groupBackdropFilter;
  final bool clip;

  @override
  Widget build(BuildContext context) {
    final content = material
        ? Material(color: Colors.transparent, child: child)
        : child;
    if (!transparentSurface || MediaQuery.highContrastOf(context)) {
      return _clipIfNeeded(
        DecoratedBox(
          decoration: BoxDecoration(
            color: color,
            borderRadius: borderRadius,
            border: border,
            boxShadow: shadows,
          ),
          child: content,
        ),
      );
    }

    final style = _styleForLayer(layer);
    final decoration = BoxDecoration(
      color: color.withValues(alpha: transparentAlpha ?? style.alpha),
      borderRadius: borderRadius,
      border: border ?? Border.all(color: Colors.white.withValues(alpha: 0.16)),
      boxShadow: shadows
          .map(
            (shadow) => BoxShadow(
              color: shadow.color.withValues(alpha: 0.08),
              offset: shadow.offset,
              blurRadius: shadow.blurRadius,
              spreadRadius: shadow.spreadRadius,
            ),
          )
          .toList(growable: false),
    );
    if (!enableBackdropFilter) {
      return _clipIfNeeded(
        DecoratedBox(decoration: decoration, child: content),
      );
    }
    final filter = ui.ImageFilter.blur(sigmaX: style.blur, sigmaY: style.blur);
    final decorated = DecoratedBox(decoration: decoration, child: content);
    return _clipBackdrop(
      groupBackdropFilter
          ? BackdropFilter.grouped(filter: filter, child: decorated)
          : BackdropFilter(filter: filter, child: decorated),
    );
  }

  Widget _clipIfNeeded(Widget child) {
    if (!clip) {
      return child;
    }
    return ClipRRect(borderRadius: borderRadius, child: child);
  }

  Widget _clipBackdrop(Widget child) {
    if (!clip) {
      return ClipRect(child: child);
    }
    return ClipRRect(borderRadius: borderRadius, child: child);
  }
}

class _ThemeGlassSurfaceStyle {
  const _ThemeGlassSurfaceStyle({required this.blur, required this.alpha});

  final double blur;
  final double alpha;
}

_ThemeGlassSurfaceStyle _styleForLayer(ThemeGlassSurfaceLayer layer) {
  return switch (layer) {
    ThemeGlassSurfaceLayer.panel => const _ThemeGlassSurfaceStyle(
      blur: 16,
      alpha: 0.045,
    ),
    ThemeGlassSurfaceLayer.card => const _ThemeGlassSurfaceStyle(
      blur: 14,
      alpha: 0.16,
    ),
    ThemeGlassSurfaceLayer.control => const _ThemeGlassSurfaceStyle(
      blur: 10,
      alpha: 0.28,
    ),
  };
}
