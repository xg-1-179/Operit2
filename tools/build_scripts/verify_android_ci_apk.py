#!/usr/bin/env python3
import hashlib
import json
import os
import struct
import subprocess
import zipfile
from pathlib import Path

from common import REPO_ROOT, read_properties

apk = REPO_ROOT / 'tools/release/dist/operit2-app-android-arm64-v8a.apk'
with zipfile.ZipFile(apk) as archive:
    bad = archive.testzip()
    if bad:
        raise RuntimeError(f'Corrupt APK entry: {bad}')
    libraries = [n for n in archive.namelist() if n.startswith('lib/') and n.endswith('.so')]
    abis = sorted({n.split('/')[1] for n in libraries})
    if abis != ['arm64-v8a']:
        raise RuntimeError(f'Unexpected APK architectures: {abis}')
    for name in ['libapp.so', 'libflutter.so', 'liboperit_flutter_bridge.so', 'libbash.so', 'liboperit_busybox.so', 'liboperit_loader.so', 'liboperit_proot.so']:
        if f'lib/arm64-v8a/{name}' not in libraries:
            raise RuntimeError(f'Missing APK library: {name}')
    for name in libraries:
        with archive.open(name) as stream:
            header = stream.read(20)
        if len(header) < 20 or header[:4] != b'\x7fELF' or header[4:6] != bytes([2, 1]) or struct.unpack_from('<H', header, 18)[0] != 183:
            raise RuntimeError(f'Not 64-bit AArch64 ELF: {name}')
    runtime_path = 'assets/android-runtime/arm64-v8a/rootfs.tar.gz.bin'
    runtime_hash = hashlib.sha256(archive.read(runtime_path)).hexdigest()
    if runtime_hash != archive.read(runtime_path + '.sha256').decode().split()[0].lower():
        raise RuntimeError('Packaged rootfs SHA256 mismatch')

sdk = Path(os.environ.get('ANDROID_HOME') or os.environ['ANDROID_SDK_ROOT'])
versions = [p for p in (sdk / 'build-tools').iterdir() if (p / 'lib/apksigner.jar').is_file()]
version = max(versions, key=lambda p: tuple(int(x) for x in p.name.split('.') if x.isdigit()))
signed = subprocess.check_output(['java', '-jar', str(version / 'lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', str(apk)], text=True)
config_path = REPO_ROOT / 'tools/release/secrets/android-signing.properties'
config = read_properties(config_path)
env = os.environ.copy()
env['OPERIT_VERIFY_STORE_PASSWORD'] = config['RELEASE_STORE_PASSWORD']
try:
    certificate = subprocess.check_output(['keytool', '-exportcert', '-keystore', str(config_path.parent / config['RELEASE_STORE_FILE']), '-storepass:env', 'OPERIT_VERIFY_STORE_PASSWORD', '-alias', config['RELEASE_KEY_ALIAS']], env=env, stderr=subprocess.PIPE)
except subprocess.CalledProcessError as exc:
    raise RuntimeError(f'Signing certificate export failed with code {exc.returncode}') from None
certificate_hash = hashlib.sha256(certificate).hexdigest()
if certificate_hash not in signed.lower():
    raise RuntimeError('APK certificate does not match the configured release key')
with apk.open('rb') as stream:
    sha = hashlib.file_digest(stream, 'sha256').hexdigest()
report = {'apk': apk.name, 'bytes': apk.stat().st_size, 'sha256': sha, 'abis': abis, 'arm64_elf_libraries': len(libraries), 'rootfs_sha256': runtime_hash, 'certificate_sha256': certificate_hash, 'signature': 'verified', 'device_test': 'not performed'}
apk.with_suffix('.apk.sha256').write_text(f'{sha}  {apk.name}\n', encoding='ascii')
apk.with_suffix('.verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
