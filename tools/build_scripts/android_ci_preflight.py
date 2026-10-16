#!/usr/bin/env python3
import ctypes
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path

from common import FLUTTER_APP_DIR, REPO_ROOT, flutter_command, flutter_pub_get, generate_dart_proxy_artifacts, read_properties
from build_flutter_android import configure_android_flutter_sdk, ensure_android_signing

REPORT = REPO_ROOT / 'target' / 'android-ci-preflight.json'
results = []


def command(args, cwd=REPO_ROOT, env=None):
    print('+ ' + ' '.join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), cwd=cwd, env=env, check=True)


def check(name, fn):
    try:
        detail = fn()
        results.append({'check': name, 'status': 'passed', 'detail': detail})
        print(f'PASS: {name}', flush=True)
    except Exception as exc:
        detail = f'Subprocess exited with code {exc.returncode}' if isinstance(exc, subprocess.CalledProcessError) else str(exc)
        results.append({'check': name, 'status': 'failed', 'detail': detail})
        print(f'FAIL: {name}: {detail}', file=sys.stderr, flush=True)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(results, indent=2), encoding='utf-8')


def gate():
    if any(item['status'] == 'failed' for item in results):
        raise SystemExit('Android preflight failed; see target/android-ci-preflight.json')


def runtime():
    base = FLUTTER_APP_DIR / 'android/app/src/main'
    for name in ['libbash.so', 'liboperit_busybox.so', 'liboperit_loader.so', 'liboperit_proot.so']:
        path = base / 'jniLibs/arm64-v8a' / name
        with path.open('rb') as stream:
            header = stream.read(20)
        if len(header) < 20 or header[:4] != b'\x7fELF' or header[4:6] != bytes([2, 1]) or struct.unpack_from('<H', header, 18)[0] != 183:
            raise RuntimeError(f'Invalid AArch64 ELF: {name}')
    rootfs = base / 'assets/android-runtime/arm64-v8a/rootfs.tar.gz.bin'
    if rootfs.stat().st_size == 0:
        raise RuntimeError('Empty rootfs')
    with rootfs.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    expected = Path(str(rootfs) + '.sha256').read_text().split()[0].lower()
    if actual != expected:
        raise RuntimeError('Rootfs SHA256 mismatch')
    return {'rootfs_sha256': actual}


def tools():
    for name in ['git', 'node', 'npm', 'corepack', 'cargo', 'rustup', 'java', 'keytool']:
        if shutil.which(name) is None:
            raise RuntimeError(f'Missing tool: {name}')
    python = REPO_ROOT / '.venv/Scripts/python.exe'
    command([python, '--version'])
    command([REPO_ROOT / '.ci-tools/typescript/node_modules/.bin/tsc.cmd', '--version'])
    targets = subprocess.check_output(['rustup', 'target', 'list', '--installed'], text=True)
    if 'aarch64-linux-android' not in targets.splitlines():
        raise RuntimeError('Missing aarch64-linux-android Rust target')
    plugin = REPO_ROOT / 'plugins/packages/buildin/workflow'
    expected = json.loads((plugin / 'package.json').read_text())['packageManager'].split('@')[-1]
    version = subprocess.check_output([shutil.which('corepack'), 'pnpm', '--version'], cwd=plugin, text=True).strip()
    if version != expected:
        raise RuntimeError(f'Plugin pnpm version {version}; expected {expected}')
    command(['node', '-e', "for (const p of ['typescript','esbuild','fflate']) console.log(p, require.resolve(p)); require('esbuild').transformSync('const x: number = 1', {loader:'ts'});"], cwd=plugin)
    libclang = REPO_ROOT / 'target/operit-build-tools/libclang.runtime.win-x64.21.1.8/runtimes/win-x64/native/libclang.dll'
    ctypes.CDLL(str(libclang))
    return {'pnpm': version, 'rust_target': 'aarch64-linux-android', 'libclang': 'loadable'}


def signing():
    ensure_android_signing()
    flutter = flutter_command()
    configure_android_flutter_sdk(flutter)
    from common import ANDROID_LOCAL_PROPERTIES, write_properties
    local = read_properties(ANDROID_LOCAL_PROPERTIES)
    local['sdk.dir'] = os.environ.get('ANDROID_HOME') or os.environ['ANDROID_SDK_ROOT']
    version = re.search(r'(?m)^version:\s*(\d+\.\d+\.\d+)\+(\d+)\s*$', (FLUTTER_APP_DIR / 'pubspec.yaml').read_text(encoding='utf-8'))
    if not version:
        raise RuntimeError('Missing Flutter release version')
    local['flutter.buildMode'] = 'release'
    local['flutter.versionName'] = version.group(1)
    local['flutter.versionCode'] = version.group(2)
    write_properties(ANDROID_LOCAL_PROPERTIES, local)
    properties = REPO_ROOT / 'tools/release/secrets/android-signing.properties'
    config = read_properties(properties)
    keystore = properties.parent / config['RELEASE_STORE_FILE']
    env = os.environ.copy()
    env['OPERIT_PREFLIGHT_STORE_PASSWORD'] = config['RELEASE_STORE_PASSWORD']
    env['OPERIT_PREFLIGHT_KEY_PASSWORD'] = config['RELEASE_KEY_PASSWORD']
    base = [shutil.which('keytool'), '-keystore', str(keystore), '-storepass:env', 'OPERIT_PREFLIGHT_STORE_PASSWORD', '-alias', config['RELEASE_KEY_ALIAS']]
    listed = subprocess.run([*base, '-list', '-v', '-J-Duser.language=en'], env=env, capture_output=True, text=True, check=True)
    if 'PrivateKeyEntry' not in listed.stdout:
        raise RuntimeError('Signing alias is not a private key entry')
    if keystore.read_bytes()[:4] != bytes.fromhex('feedfeed') and config['RELEASE_KEY_PASSWORD'] != config['RELEASE_STORE_PASSWORD']:
        raise RuntimeError('PKCS12 signing requires matching key and store passwords in this build pipeline')
    certificate = subprocess.run([*base, '-exportcert'], env=env, capture_output=True, check=True).stdout
    # A CSR proves the configured key password can unlock the private key.
    subprocess.run([*base, '-certreq', '-keypass:env', 'OPERIT_PREFLIGHT_KEY_PASSWORD'], env=env, capture_output=True, check=True)
    return {'certificate_sha256': hashlib.sha256(certificate).hexdigest()}


def plugins():
    generate_dart_proxy_artifacts()
    command([REPO_ROOT / '.venv/Scripts/python.exe', REPO_ROOT / 'plugins/tools/sync_plugin_packages.py', '--source', 'runtime', '--no-hot-reload'])
    return 'Built-in and external plugins built and synchronized'


def dependencies():
    flutter_pub_get(enforce_lockfile=True)
    return 'Pinned Flutter dependencies resolved'


def android_sdk():
    sdk = Path(os.environ.get('ANDROID_HOME') or os.environ['ANDROID_SDK_ROOT'])
    flutter_sdk = Path(flutter_command()).parent.parent
    extension = flutter_sdk / 'packages/flutter_tools/gradle/src/main/kotlin/FlutterExtension.kt'
    command([flutter_command(), 'precache', '--android'], cwd=FLUTTER_APP_DIR)
    wrapper_cache = flutter_sdk / 'bin/cache/artifacts/gradle_wrapper'
    for relative in ['gradlew.bat', 'gradlew', 'gradle/wrapper/gradle-wrapper.jar']:
        destination = FLUTTER_APP_DIR / 'android' / relative
        if not destination.is_file():
            source_file = wrapper_cache / relative
            if not source_file.is_file():
                raise RuntimeError(f'Missing Flutter Gradle wrapper artifact: {relative}')
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_file, destination)
    source = extension.read_text(encoding='utf-8')
    ndk_match = re.search(r'val ndkVersion[^=]*=\s*"([0-9.]+)"', source)
    api_match = re.search(r'val compileSdkVersion[^=]*=\s*(\d+)', source)
    if not ndk_match or not api_match:
        raise RuntimeError('Cannot resolve Android SDK pins from selected Flutter SDK')
    ndk_version = ndk_match.group(1)
    api = api_match.group(1)
    managers = list((sdk / 'cmdline-tools').glob('*/bin/sdkmanager.bat'))
    manager = sdk / 'cmdline-tools/latest/bin/sdkmanager.bat'
    if not manager.is_file():
        manager = max(managers)
    command([manager, f'--sdk_root={sdk}', '--install', f'ndk;{ndk_version}', f'platforms;android-{api}'])
    toolchain = sdk / f'ndk/{ndk_version}/toolchains/llvm/prebuilt/windows-x86_64'
    for relative in ['bin/aarch64-linux-android23-clang.cmd', 'bin/llvm-ar.exe', 'sysroot/usr/include/stdio.h']:
        if not (toolchain / relative).is_file():
            raise RuntimeError(f'Missing Android native build input: {relative}')
    return {'ndk': ndk_version, 'compile_sdk': api}


def dart_analysis():
    command([flutter_command(), 'analyze', '--no-pub', '--no-fatal-infos', '--no-fatal-warnings', 'lib'], cwd=FLUTTER_APP_DIR)
    return 'Application Dart sources analyzed'


if __name__ == '__main__':
    check('Android runtime ELF and rootfs integrity', runtime)
    check('Python, Node, pnpm, Rust and bindgen tools', tools)
    check('Signing private key and Flutter SDK configuration', signing)
    gate()
    check('Complete runtime plugin build and proxy generation', plugins)
    check('Locked Flutter dependency resolution', dependencies)
    check('Pinned Android SDK, NDK and cross compiler', android_sdk)
    gate()
    check('Flutter application static analysis', dart_analysis)
    gate()
    print('All Android preflight checks passed', flush=True)
