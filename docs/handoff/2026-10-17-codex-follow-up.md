# Codex follow-up, 2026-10-17

Base: xg-1-179/Operit2 main, 2f038b52a16a2857110c1debe0e2ee0a49d2f78a.
Checkout uses sparse paths because repository resources are large. Source changes
are local and have not been pushed or built into a new APK.

## Plugin Compatibility

Fixed permanent destruction on dependency loss, missing tool ownership cleanup,
lost async registration ownership, missing config forwarding, async cleanup,
service class mounting, late inherited service properties, out-of-order provider
disposal and inconsistent once event handling. Added a locked npm project and an
integration test that packages a fixture, loads the generated tool, calls it and
unloads it. Fixed Windows bundle imports and missing-service diagnostics.

Validation: 21 Node tests passed; npm audit reported zero vulnerabilities;
git diff --check passed. Fixtures are synthetic contract tests, not an upstream
DeepSeek Harness plugin or an Android installation test. Full DSH compatibility
remains incomplete; see tools/dsh-compat/README.md.

## Flutter UI

Shared Agent/Classic glass input now has pointer feedback, a short scale response,
animated rim and zero resting shader capture intensity. High contrast uses an
opaque surface; reduced motion disables deformation and active sampling. Repeated
glass cards skip per-card backdrop blur. Composer expansion is shorter and send/
stop icon changes crossfade and scale. Greeting text can wrap in narrow layouts.
Existing appearance preferences still control glass visibility.

Added input_glass_interaction_test.dart for resting/pressed glass, reduced motion
and high contrast. Flutter SDK is not installed locally; these tests, analyzer,
screenshots, Android build and device frame timings have NOT been run. No measured
performance improvement or complete visual redesign is claimed.

Next verification in a configured Flutter environment:

```powershell
cd apps/flutter/packages/operit_ui
flutter pub get
flutter analyze
flutter test
```

Remaining integration: canonical SDK lifecycle type declarations and regenerated
bindings; upstream real plugin fixtures; host adapters for DSH-only services;
complete conversation/navigation visual design; Android release build and device
profiling. Do not use the previous desktop APK to evaluate these local changes.
