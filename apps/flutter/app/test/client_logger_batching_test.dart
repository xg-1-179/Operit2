import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:operit2/core/logging/ClientLogger_io.dart' as backend;
import 'package:operit2/core/logging/ClientLogLevel.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('log bursts share a flush and failed storage retains every line', () async {
    const channel = MethodChannel('operit/runtime');
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    var connections = 0;
    messenger.setMockMethodCallHandler(channel, (call) async {
      expect(call.method, 'connectCoreFfi');
      connections++;
      throw PlatformException(code: 'TEST_STORAGE_UNAVAILABLE');
    });
    addTearDown(() => messenger.setMockMethodCallHandler(channel, null));

    await backend.initialize();
    for (var i = 0; i < 1000; i++) {
      backend.write(ClientLogLevel.info, 'before-$i');
    }
    expect(connections, 0);
    backend.attachPersistentStorage();
    for (var i = 0; i < 1000; i++) {
      backend.write(ClientLogLevel.info, 'after-$i');
    }
    final text = await backend.readText();
    expect(connections, 1);
    expect(text.split('\n').where((line) => line.isNotEmpty).length, 2000);
    expect(text, startsWith('before-0\n'));
    expect(text, endsWith('after-999\n'));
    expect(backend.lastWriteError(), contains('TEST_STORAGE_UNAVAILABLE'));

    backend.attachPersistentStorage();
    expect(await backend.readText(), text);
    expect(connections, 2);
  });
}
