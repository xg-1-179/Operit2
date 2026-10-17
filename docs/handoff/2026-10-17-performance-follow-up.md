# Operness performance follow-up

## Implemented

- Standalone HTML preview: calculate full-resolution liquid-glass normal maps in
  one Worker, with at most one in-flight map per surface. Coalesce subsequent
  resize requests and keep the previous map visible until replacement is ready.
- Use asynchronous PNG encoding and Blob URLs instead of synchronous base64
  encoding. Revoke replaced URLs. If Workers are unavailable, compute in small
  batches that yield to the event loop. Keep all optical parameters unchanged.
- Flutter input menu: reuse converted menu data and initialize its change
  signature after loading. Keep the one-second polling interval unchanged.
- Flutter menu statistics: only publish changed statistics; update counters and
  the completed summary future in the same state change. Keep all statistics.
- Flutter input glass: subscribe only to relevant MediaQuery aspects; rebuild
  pressed state on the first pointer down and final pointer release. Preserve
  multi-touch, cancellation, glass effects and accessibility behavior.

## Verification

- HTML Node tests: 3 passed (syntax, pixel parity, cooperative yielding).
- CSS parsed using css-tree without errors.
- Existing dsh compatibility tests: 21 passed.
- Added Flutter multi-pointer regression test, NOT executed: no local Flutter
  or Dart SDK. Flutter analyzer and Android runtime performance are unverified.
- Browser visual verification not performed: local file access was rejected
  by the browser tool URL policy. No server was created to bypass that policy.
- Additional sparse-checkout source fetch did not finish and was stopped.
  Rust execution, FFI streaming, Android runtime and system scheduling were not
  modified. These changes are not evidence of a system-level FPS improvement.

## Before claiming a measured improvement

On the same Android device and profile build, compare UI/raster frame times,
missed frames, memory and CPU for long conversations, streamed responses,
keyboard transitions, resizing and plugin-menu polling. Preserve visual settings
and plugin workload in both runs. No APK was built in this step.

## Application runtime follow-up

- Hydrated five previously absent source files from a local snapshot only after
  verifying each blob hash matches HEAD. Existing changes were preserved.
- OpenAI (including compatible providers), Claude and Gemini now use a shared
  cursor-based streaming line buffer. Extracting each SSE line no longer drains
  and shifts the remaining bytes or creates an intermediate byte vector. The
  scan cursor skips already inspected bytes when a partial line arrives across
  many transport chunks. Compaction is amortized across consumed input.
- Preserved trimming, CRLF handling, strict UTF-8 validation, blank lines,
  unterminated tails, event ordering and provider parsing/tool-call behavior.
- Added Rust tests for large multi-line batches, compaction across incomplete
  UTF-8, long partial lines and buffer reuse, retaining five existing tests.
- Client logging coalesces a synchronous burst into one queued write pass;
  permits one subsequent pending pass while storage is awaited. No filtering,
  dropping, sampling or intentional write delay. Startup memory logging no
  longer allocates a persistence task per entry before storage is requested.
- Added a Flutter logger regression for burst coalescing, startup isolation,
  retained ordering and explicit retry after an unavailable storage sink.
- Verification: dsh Node tests 21 passed; git diff --check passed. New Rust and
  Flutter tests and compiler/analyzer checks NOT executed (toolchains absent).
  Run `cargo test -p operit-providers StreamingResponseLines` from core and
  `flutter test test/client_logger_batching_test.dart` from the Flutter app
  with the project's pinned SDK before building. No APK or device profiling.
- Native FFI ownership and Android scheduling were deliberately unchanged;
  this is application runtime optimization, not measured system-wide tuning.
