import 'package:flutter/material.dart';

/// A compact, theme-aware surface shared by the composer's native/plugin menus.
class ComposerPopupSurface extends StatelessWidget {
  const ComposerPopupSurface({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final highContrast = MediaQuery.highContrastOf(context);
    return Material(
      color: colors.surfaceContainer,
      surfaceTintColor: Colors.transparent,
      elevation: highContrast ? 0 : 8,
      shadowColor: colors.shadow.withValues(alpha: 0.20),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(
          color: highContrast
              ? colors.onSurface
              : colors.outlineVariant.withValues(alpha: 0.65),
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: child,
    );
  }
}

/// Animates only compositing properties; menu layout/content is not tick-driven.
class ComposerPopupTransition extends StatefulWidget {
  const ComposerPopupTransition({
    super.key,
    required this.child,
    this.alignEnd = false,
  });

  final Widget child;
  final bool alignEnd;

  @override
  State<ComposerPopupTransition> createState() =>
      _ComposerPopupTransitionState();
}

class _ComposerPopupTransitionState extends State<ComposerPopupTransition>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 200),
  );
  late final CurvedAnimation _curve = CurvedAnimation(
    parent: _controller,
    curve: Curves.easeOutCubic,
  );
  late final Animation<double> _scale =
      Tween<double>(begin: 0.97, end: 1).animate(_curve);
  late final Animation<Offset> _offset =
      Tween<Offset>(begin: const Offset(0, 0.035), end: Offset.zero)
          .animate(_curve);
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final media = MediaQuery.of(context);
    if (media.disableAnimations || media.accessibleNavigation) {
      _controller.value = 1;
      _started = true;
    } else if (!_started) {
      _started = true;
      _controller.forward();
    }
  }

  @override
  void dispose() {
    _curve.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
    opacity: _curve,
    child: SlideTransition(
      position: _offset,
      child: ScaleTransition(
        scale: _scale,
        alignment: (widget.alignEnd
            ? AlignmentDirectional.bottomEnd
            : AlignmentDirectional.bottomStart).resolve(Directionality.of(context)),
        child: RepaintBoundary(child: widget.child),
      ),
    ),
  );
}
