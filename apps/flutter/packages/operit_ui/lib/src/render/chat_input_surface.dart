import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';
import 'package:liquid_glass_widgets/widgets/shared/glass_effect.dart';

import 'bubble_surface.dart';

class AgentInputSurface extends StatelessWidget {
  /// Creates the agent surface with its original system-inset placement.
  const AgentInputSurface({
    super.key,
    required this.color,
    required this.floating,
    required this.shape,
    required this.borderRadius,
    required this.child,
    required this.width,
    required this.margin,
    required this.transparentSurface,
    this.imageStyle,
  });

  final Color color;
  final bool floating;
  final ShapeBorder shape;
  final BorderRadius borderRadius;
  final Widget child;
  final double width;
  final EdgeInsetsGeometry margin;
  final bool transparentSurface;
  final BubbleImageStyle? imageStyle;

  /// Retains the input surface paint while keyboard motion changes its position.
  @override
  Widget build(BuildContext context) {
    final useImage = imageStyle != null;
    final effectiveColor = (transparentSurface || useImage)
        ? Colors.transparent
        : color;
    final decorated = RepaintBoundary(
      child: SizedBox(
        width: width,
        child: ClipPath(
          clipper: ShapeBorderClipper(shape: shape),
          child: Stack(
            children: <Widget>[
              Positioned.fill(
                child: DecoratedBox(
                  key: const ValueKey<String>('chat.input.surface'),
                  decoration: ShapeDecoration(
                    color: effectiveColor,
                    shape: shape,
                    shadows: (transparentSurface || useImage)
                        ? const <BoxShadow>[]
                        : <BoxShadow>[
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.08),
                              blurRadius: 18,
                              spreadRadius: 1,
                              offset: const Offset(0, -4),
                            ),
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.035),
                              blurRadius: 5,
                              spreadRadius: 0,
                              offset: const Offset(0, -1),
                            ),
                          ],
                  ),
                ),
              ),
              if (useImage)
                Positioned.fill(
                  child: BubbleImageBackgroundSurface(imageStyle: imageStyle!),
                ),
              SafeArea(
                top: false,
                left: false,
                right: false,
                bottom: !floating,
                child: child,
              ),
            ],
          ),
        ),
      ),
    );
    final Widget surface;
    if (transparentSurface && !useImage) {
      final settings = _inputTransparentGlassSettings(context);
      surface = _InteractiveInputGlass(
        shape: shape,
        borderRadius: borderRadius,
        settings: settings,
        child: decorated,
      );
    } else {
      surface = decorated;
    }
    return SafeArea(
      top: false,
      left: false,
      right: false,
      bottom: floating,
      child: Padding(padding: margin, child: surface),
    );
  }
}

LiquidGlassSettings _inputTransparentGlassSettings(BuildContext context) {
  final dark = Theme.of(context).brightness == Brightness.dark;
  return LiquidGlassSettings(
    glassColor: dark ? const Color(0x08FFFFFF) : const Color(0x07FFFFFF),
    thickness: 80,
    blur: 8,
    chromaticAberration: 0.18,
    lightIntensity: 0.42,
    ambientStrength: 0.2,
    refractiveIndex: 1.16,
    saturation: 1.04,
    glowIntensity: 0.17,
    specularSharpness: GlassSpecularSharpness.soft,
    standardOpacityMultiplier: 0.12,
  );
}

class ClassicInputSurface extends StatelessWidget {
  /// Creates the classic surface with its original system-inset placement.
  const ClassicInputSurface({
    super.key,
    required this.color,
    required this.floating,
    required this.shape,
    required this.borderRadius,
    required this.transparentSurface,
    required this.width,
    required this.margin,
    required this.child,
    this.imageStyle,
  });

  final Color color;
  final bool floating;
  final ShapeBorder shape;
  final BorderRadius borderRadius;
  final bool transparentSurface;
  final double width;
  final EdgeInsetsGeometry margin;
  final Widget child;
  final BubbleImageStyle? imageStyle;

  /// Builds the classic input surface with opaque, nine-slice or glass styling.
  @override
  Widget build(BuildContext context) {
    final useImage = imageStyle != null;
    final effectiveColor = (transparentSurface || useImage)
        ? Colors.transparent
        : color;
    final decorated = SizedBox(
      width: width,
      child: ClipPath(
        clipper: ShapeBorderClipper(shape: shape),
        child: Stack(
          children: <Widget>[
            Positioned.fill(
              child: DecoratedBox(
                key: const ValueKey<String>('chat.input.surface'),
                decoration: ShapeDecoration(
                  color: effectiveColor,
                  shape: shape,
                  shadows: (transparentSurface || useImage)
                      ? const <BoxShadow>[]
                      : <BoxShadow>[
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.08),
                            blurRadius: 14,
                            offset: const Offset(0, -3),
                          ),
                        ],
                ),
              ),
            ),
            if (useImage)
              Positioned.fill(
                child: BubbleImageBackgroundSurface(imageStyle: imageStyle!),
              ),
            SafeArea(
              top: false,
              left: false,
              right: false,
              bottom: !floating,
              child: child,
            ),
          ],
        ),
      ),
    );
    final Widget surface;
    if (transparentSurface && !useImage) {
      final settings = _classicInputGlassSettings(context);
      surface = _InteractiveInputGlass(
        shape: shape,
        borderRadius: borderRadius,
        settings: settings,
        child: decorated,
      );
    } else {
      surface = decorated;
    }
    return SafeArea(
      top: false,
      left: false,
      right: false,
      bottom: floating,
      child: Padding(padding: margin, child: surface),
    );
  }
}

/// Builds the glass settings used by the classic transparent input surface.
LiquidGlassSettings _classicInputGlassSettings(BuildContext context) {
  final dark = Theme.of(context).brightness == Brightness.dark;
  return LiquidGlassSettings(
    glassColor: dark ? const Color(0x08FFFFFF) : const Color(0x07FFFFFF),
    thickness: 80,
    blur: 8,
    chromaticAberration: 0.18,
    lightIntensity: 0.42,
    ambientStrength: 0.2,
    refractiveIndex: 1.16,
    saturation: 1.04,
    glowIntensity: 0.17,
    specularSharpness: GlassSpecularSharpness.soft,
    standardOpacityMultiplier: 0.12,
  );
}

class _InteractiveInputGlass extends StatefulWidget {
  const _InteractiveInputGlass({
    required this.shape,
    required this.borderRadius,
    required this.settings,
    required this.child,
  });

  final ShapeBorder shape;
  final BorderRadius borderRadius;
  final LiquidGlassSettings settings;
  final Widget child;

  @override
  State<_InteractiveInputGlass> createState() => _InteractiveInputGlassState();
}

class _InteractiveInputGlassState extends State<_InteractiveInputGlass>
    with SingleTickerProviderStateMixin {
  final Set<int> _pointers = <int>{};
  bool _hovered = false;
  bool _reducedMotion = false;
  late final AnimationController _interaction = AnimationController(
    vsync: this,
    upperBound: 0.6,
    duration: const Duration(milliseconds: 180),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reducedMotion = MediaQuery.disableAnimationsOf(context) ||
        MediaQuery.accessibleNavigationOf(context);
    _animateInteraction();
  }

  void _animateInteraction() {
    if (_reducedMotion) {
      _interaction.value = 0;
    } else {
      _interaction.animateTo(
        _pointers.isNotEmpty ? 0.6 : 0,
        curve: Curves.easeOutCubic,
      );
    }
  }

  @override
  void dispose() {
    _interaction.dispose();
    super.dispose();
  }

  void _press(int pointer) {
    if (!mounted) return;
    final wasPressed = _pointers.isNotEmpty;
    _pointers.add(pointer);
    if (!wasPressed) {
      _animateInteraction();
      setState(() {});
    }
  }

  void _release(int pointer) {
    if (!mounted) return;
    if (_pointers.remove(pointer) && _pointers.isEmpty) {
      _animateInteraction();
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final reducedMotion = MediaQuery.disableAnimationsOf(context) ||
        MediaQuery.accessibleNavigationOf(context);
    final opaque = MediaQuery.highContrastOf(context);
    final pressed = _pointers.isNotEmpty;
    final active = pressed || _hovered;
    final duration = reducedMotion
        ? Duration.zero
        : const Duration(milliseconds: 180);
    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: Listener(
        onPointerDown: (event) => _press(event.pointer),
        onPointerUp: (event) => _release(event.pointer),
        onPointerCancel: (event) => _release(event.pointer),
        child: AnimatedScale(
          scale: pressed && !reducedMotion ? 0.995 : 1,
          duration: duration,
          curve: Curves.easeOutCubic,
          child: ClipPath(
            clipper: ShapeBorderClipper(shape: widget.shape),
            child: Stack(
              children: <Widget>[
                Positioned.fill(
                  child: opaque
                      ? ColoredBox(color: scheme.surface)
                      : BackdropFilter(
                          filter: ui.ImageFilter.blur(sigmaX: 8, sigmaY: 8),
                          child: ColoredBox(
                            color: scheme.surface.withValues(alpha: 0.72),
                          ),
                        ),
                ),
                if (!opaque)
                  Positioned.fill(
                    child: IgnorePointer(
                      child: GlassEffect(
                        quality: GlassQuality.standard,
                        shape: LiquidRoundedSuperellipse(
                          borderRadius: widget.borderRadius.topLeft.x,
                        ),
                        settings: widget.settings,
                        // Resting glass must not keep a background capture ticker alive.
                        interactionIntensity: pressed && !reducedMotion ? 0.6 : 0,
                        interactionAnimation: _interaction,
                        ambientRim: 0.11,
                        baseAlphaMultiplier: 0.75,
                        edgeAlphaMultiplier: 0.75,
                        rimThickness: 1.48,
                        rimSmoothing: 8,
                        child: const SizedBox.expand(),
                      ),
                    ),
                  ),
                widget.child,
                Positioned.fill(
                  child: IgnorePointer(
                    child: _InputGlassRim(
                      duration: duration,
                      borderRadius: widget.borderRadius,
                      color: active
                          ? scheme.primary.withValues(alpha: 0.35)
                          : scheme.onSurface.withValues(alpha: 0.10),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The highlight ticks in paint, without rebuilding or laying out the input.
class _InputGlassRim extends ImplicitlyAnimatedWidget {
  const _InputGlassRim({
    required super.duration,
    required this.borderRadius,
    required this.color,
  });

  final BorderRadius borderRadius;
  final Color color;

  @override
  ImplicitlyAnimatedWidgetState<_InputGlassRim> createState() =>
      _InputGlassRimState();
}

class _InputGlassRimState
    extends ImplicitlyAnimatedWidgetState<_InputGlassRim> {
  ColorTween? _color;

  @override
  void forEachTween(TweenVisitor<dynamic> visitor) {
    _color = visitor(
      _color,
      widget.color,
      (dynamic value) => ColorTween(begin: value as Color),
    ) as ColorTween?;
  }

  @override
  Widget build(BuildContext context) => RepaintBoundary(
    child: CustomPaint(
      painter: _InputGlassRimPainter(
        color: _color!,
        progress: animation,
        borderRadius: widget.borderRadius,
        targetColor: widget.color,
      ),
      child: const SizedBox.expand(),
    ),
  );
}

class _InputGlassRimPainter extends CustomPainter {
  _InputGlassRimPainter({
    required this.color,
    required this.progress,
    required this.borderRadius,
    required this.targetColor,
  }) : super(repaint: progress);

  final ColorTween color;
  final Animation<double> progress;
  final BorderRadius borderRadius;
  final Color targetColor;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    canvas.drawRRect(
      borderRadius.toRRect(Offset.zero & size).deflate(0.5),
      Paint()
        ..color = color.evaluate(progress)!
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );
  }

  @override
  bool shouldRepaint(covariant _InputGlassRimPainter oldDelegate) =>
      color != oldDelegate.color ||
      progress != oldDelegate.progress ||
      targetColor != oldDelegate.targetColor ||
      borderRadius != oldDelegate.borderRadius;
}
