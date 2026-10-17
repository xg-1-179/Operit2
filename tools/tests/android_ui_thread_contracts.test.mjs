import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const base = new URL('../../apps/flutter/app/android/app/src/main/kotlin/app/operit/', import.meta.url);
const source = name => readFileSync(new URL(name, base), 'utf8');

// These guard thread placement, not Android runtime behavior or frame times.
function section(text, start, end) {
  const first = text.indexOf(start);
  assert.notEqual(first, -1, `Missing ${start}`);
  const last = text.indexOf(end, first + start.length);
  assert.notEqual(last, -1, `Missing ${end}`);
  return text.slice(first, last);
}

test('clipboard snapshots URIs before dispatching provider reads off-main', () => {
  const method = section(source('AndroidPlatformChannel.kt'),
    'private fun readClipboardImages(', 'private fun imageMimeTypeForUri(');
  const dispatch = method.indexOf('runtimeHost.runIo(result, "CLIPBOARD_IMAGE_READ_ERROR")');
  assert.ok(dispatch > 0);
  assert.match(method.slice(0, dispatch), /clipboard.primaryClip/);
  assert.doesNotMatch(method.slice(0, dispatch), /imageMimeTypeForUri\(|readUriBytes\(/);
  assert.match(method.slice(dispatch), /for \(uri in uris\)/);
  assert.match(method.slice(dispatch), /imageMimeTypeForUri\(uri\)/);
  assert.match(method.slice(dispatch), /readUriBytes\(uri\)/);
  assert.doesNotMatch(method.slice(dispatch), /runOnUiThread|result.success/);
});

test('provider IO and native calls use separate reusable executors', () => {
  const host = source('AndroidRuntimeHost.kt');
  assert.match(host, /private val ioExecutor: ExecutorService/);
  assert.match(host, /private val runtimeExecutor: ExecutorService/);
  assert.match(host, /runOnExecutor\(ioExecutor, result, errorCode, block\)/);
  assert.match(host, /runOnExecutor\(runtimeExecutor, result, "RUNTIME_BRIDGE_ERROR", block\)/);
  const paths = section(source('AndroidPlatformChannel.kt'),
    'private fun androidRuntimePaths(', 'private fun localRuntimeStorageDefaults(');
  assert.match(paths, /runtimeHost.runIo\(result\)/);
  assert.doesNotMatch(paths, /Thread\s*\{/);
  const destroy = section(host, 'fun destroy()', 'fun readHostSecret(');
  assert.match(destroy, /ioExecutor.shutdownNow\(\)/);
  assert.match(destroy, /runtimeExecutor.shutdownNow\(\)/);
});

test('native bridge replies encode on workers, retaining error completion', () => {
  const dispatch = section(source('AndroidRuntimeHost.kt'),
    'private fun <T> runOnExecutor(', 'fun runBackground(');
  assert.match(dispatch, /executor.execute\s*\{[\s\S]*val response = block\(\)[\s\S]*result.success\(response\)/);
  assert.match(dispatch, /catch \(error: Throwable\)/);
  assert.match(dispatch, /catch \(error: java.util.concurrent.RejectedExecutionException\)/);
  assert.doesNotMatch(dispatch, /mainHandler|runOnUiThread/);
});

test('document chunks retain worker ordering and encode off-main', () => {
  const document = source('DocumentInputChannel.kt');
  const background = section(document, 'private fun background(', 'private fun describe(');
  assert.match(background, /worker.execute\s*\{/);
  assert.match(background, /val value = operation\(\)/);
  assert.match(background, /result.success\(value\)/);
  assert.match(background, /result.error\(errorCode, error.message, null\)/);
  assert.doesNotMatch(background, /runOnUiThread/);
  assert.match(document, /Executors.newSingleThreadExecutor\(\)/);
  assert.match(document, /MAX_CHUNK_SIZE = 1024 \* 1024/);
});
