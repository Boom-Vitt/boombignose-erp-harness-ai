import 'package:bbn_mobile/pairing.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final now = DateTime.utc(2026, 11, 3, 10);
  final exp = now.add(const Duration(minutes: 5)).millisecondsSinceEpoch ~/ 1000;
  String uri(String base, {int? e}) =>
      'bbn-pair://redeem?u=${Uri.encodeComponent(base)}&t=tok&o=Acme&e=${e ?? exp}';

  test('parses a valid code', () {
    final p = PairPayload.parse(uri('https://mac.tail1.ts.net'), now: now);
    expect([p.baseUrl, p.token, p.orgName], ['https://mac.tail1.ts.net', 'tok', 'Acme']);
  });

  test('rejects expired, non-https and foreign codes', () {
    for (final bad in [
      uri('https://mac.tail1.ts.net', e: now.millisecondsSinceEpoch ~/ 1000),
      uri('http://100.1.2.3:3100'),
      'https://example.com',
      'bbn-pair://redeem?u=https%3A%2F%2Fx.ts.net',
    ]) {
      expect(() => PairPayload.parse(bad, now: now), throwsFormatException);
    }
  });
}
