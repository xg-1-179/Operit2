# Operit2 DSH compatibility runtime

This is a partial Cordis-compatible runtime and ToolPkg porter, not a complete
DeepSeek Harness host. It supports tools, asynchronous files, HTTP, configuration,
logging and storage backed by Operit2. Required services that have no adapter
(including llm, sessions, agentLoop, sandbox, approval and mcp) fail packaging with
their names instead of producing a silently inactive package.

## Development

```powershell
cd tools/dsh-compat
npm ci
npm test
node port-dsh-plugin.mjs path/to/plugin --out path/to/empty-output
```

The output directory must be empty. Packaging imports and executes plugin code
under Node to capture tool declarations, so use plugins from a trusted source.
The capture process has a 15-second timeout. Installation and QuickJS execution
inside the Android application still require device validation.

## Verified Behavior

- Missing required services leave plugins pending; returning services remount them.
- Async apply receives config and retains effect ownership after await.
- Tools, listeners, service claims and isolated children are cleaned with their owner.
- Async cleanup is awaited in reverse order and errors are isolated.
- Service classes, optional injection declarations and event once handlers work.
- The porter resolves cordis to this shim, supports Windows paths, waits for root
  initialization and creates a ZIP ToolPkg verified by the integration test.

Async mounts must finish before their resources can be fully reclaimed. A plugin
that never resolves initialization remains subject to the host lifecycle timeout.
Provider replacement while a same-named service remains available, full Cordis
API compatibility, dynamic late tool discovery, profiles, config reconciliation,
and session-scoped adapters are not implemented.
