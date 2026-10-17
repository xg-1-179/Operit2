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

## Android thread and glass-animation follow-up

- Clipboard image URI discovery stays on the activity thread; provider MIME
  queries and full image reads move to a dedicated two-worker IO pool. Runtime
  path requests reuse that pool instead of allocating a thread per request.
  Native runtime calls retain their separate eight-worker pool. No attachment
  compression, sampling or feature removal. Both pools shut down with the host.
- Native results and ordered document chunks are encoded/replied on their
  workers instead of posting large payloads back to the Android UI thread.
  Flutter explicitly permits MethodChannel.Result callbacks on any thread:
  https://api.flutter.dev/javadoc/io/flutter/plugin/common/MethodChannel.Result.html
- Glass shader preparation now shares one pending future across widgets.
  Passive capture releases its image when inactive, honors TickerMode and
  rejects an obsolete asynchronous capture after interaction stops. Premium
  Impeller rendering no longer also captures a background image it does not use.
- The input rim retains its 180 ms color animation but ticks directly in
  CustomPainter behind a repaint boundary, without per-frame widget build or
  layout. Glass blur, refraction, scale, colors and visual settings are unchanged.
- Local verification: 25 Node tests passed (21 DSH/plugin tests and four source
  thread-contract tests). These source checks do not compile Kotlin or measure
  runtime behavior. Flutter regression tests cover repaint-only rim animation
  and independent visibility/gesture pause-resume cycles. Cloud validation is
  provided by the manual Operness Performance Checks workflow.
- No connected Android device is available. Actual UI/raster timings, memory
  usage, Kotlin compilation and frame-rate improvements remain unverified.
  The desktop Operness-2.0.0.apk is build 20 and does not contain these changes.

## Composer UI and streaming-render follow-up

- Mention, model, input-action and attachment overlays now share a 200 ms
  fade/slide/scale entrance. Their content is retained behind a repaint boundary;
  animation ticks do not rebuild menu contents. Directional anchors resolve for
  RTL and reduced-motion/accessibility preferences bypass the entrance.
- Input-action, model and attachment menus share a compact theme-aware surface
  with consistent corners, border and shadow. This is a focused composer polish,
  not a completed redesign of every application screen. Existing glass blur,
  refraction and plugin actions remain available.
- Streaming Markdown reuses source-line splits and caches inline spans until
  text, style, child nodes, link callback or inherited dependencies change.
  The progressive reveal still rebuilds its reveal tree; it is not paint-only.
- Added popup lifecycle/accessibility/RTL/tap regressions and Markdown math,
  text/style and link-callback cache regressions. Flutter execution is pending:
  the initial cloud run failed before dependency resolution because FVM's
  package executable is not named bin/fvm.dart. The workflow now invokes
  bin/fvm.bat from the actual PUB_CACHE and checks activation errors.
- Re-ran 25 Node tests successfully. No connected Android device, frame timing
  comparison, visual device QA or newly built APK is available for this batch.
- DSH support remains a partial Cordis runtime and ToolPkg porter: tools, async
  filesystem, HTTP, configuration, logger and storage adapters are implemented.
  LLM, sessions, agentLoop, sandbox, approval, MCP and full Cordis compatibility
  are not implemented. Android QuickJS installation/execution is unverified.

## Continuous input refraction follow-up

- Input deformation now eases between 0 and the existing 0.6 peak over 180 ms,
  including interrupted press/release sequences. The optional intensity animation
  notifies the shader render object directly instead of rebuilding input content
  on each tick. Render listeners attach/detach with their render object and are
  replaced safely when the animation source changes.
- Capture activation still honors intensity, TickerMode, quality, background
  availability and blur. A state update is needed only at capture transitions;
  changed background content retains the existing capture invalidation path.
- Existing blur, refraction, highlights, multi-touch and accessibility settings
  are retained. Added continuous press/release and disposal regression coverage.
- Performance CI now generates required application proxy contracts before app
  analysis. UI interaction checks run first, independently of proxy compilation.
  The previous app analysis failed because generated proxy files were absent;
  that failure is not a successful rendering or application validation.
- Local Android/DSH Node regressions: 25 passed. Flutter compilation, animation
  regressions, device profiling and a new APK remain pending for this change.

## Composer notification and grapheme follow-up

- Cloud run 39017474455: focused UI analyzer passed; 11 interaction tests
  passed, one disposal regression failed. A late pointer cancellation invoked
  animateTo after AnimationController.dispose. Pointer callbacks now reject
  unmounted state; the regression remains enabled. Interrupted gestures are
  additionally covered. The run was cancelled to retrieve diagnostics.
- Generated app proxy contracts successfully. Full app analysis reported 95
  warnings/informational lints, no compiler errors. CI continues to fail on
  analyzer errors, reports existing warnings without blocking rendering tests,
  and runs rendering regressions separately so diagnostics cannot hide tests.
- Composer controller notifications ignore selection/composing-only updates.
  Parent chrome rebuilds only when trimmed draft presence changes; the editor
  still receives every text change. Controller replacement resets both caches.
  A Node source-contract test guards this wiring, not actual widget behavior.
- Streaming reveal caches UTF-16 grapheme boundaries per source span instead
  of repeatedly scanning text on every reveal frame. Source/style/dependency
  changes invalidate this cache together with the inline span. Emoji and
  combining-character regressions cover whole-cluster rendering.
- Restored card backdrop blur (sigma 14) and original 0.16 transparency, which
  commit 1c8ef58 had replaced with unblurred alpha 0.88. This honors the user's
  explicit requirement not to remove visual effects; high contrast and explicit
  opt-out remain supported. Blur restoration may increase raster work and must
  be profiled rather than claimed as a performance improvement.
- No new APK, connected-device frame profiling or full-app UI redesign has
  been completed. DSH support remains partial as documented above.
