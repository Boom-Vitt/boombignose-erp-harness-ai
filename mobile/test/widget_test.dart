import 'package:bbn_mobile/pairing.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

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
      uri('https://public.example'),
      uri('https://mac.tail1.ts.net.evil.example'),
      uri('https://user:password@mac.tail1.ts.net'),
      uri('https://mac.tail1.ts.net:8443'),
      uri('https://mac.tail1.ts.net/path'),
      uri('https://mac.tail1.ts.net?redirect=evil'),
      'bbn-pair://other?u=https%3A%2F%2Fmac.tail1.ts.net&t=tok&e=$exp',
      'https://example.com',
      'bbn-pair://redeem?u=https%3A%2F%2Fx.ts.net',
    ]) {
      expect(() => PairPayload.parse(bad, now: now), throwsFormatException);
    }
  });

  test('ERP opens normal login without a token or issuer session', () {
    final link = Link('https://mac.tail1.ts.net', 'Workspace', 'status-only-secret');
    expect(erpLoginUrl(link).toString(), 'https://mac.tail1.ts.net/login');
    expect(erpLoginUrl(link).hasQuery, false);
  });

  test('WebView stays within the exact paired HTTPS origin', () {
    final base = Uri.parse('https://mac.tail1.ts.net');
    expect(allowedErpNavigation(base, base.resolve('/login/mfa')), true);
    for (final url in [
      'https://other.tail1.ts.net/login',
      'https://mac.tail1.ts.net.evil.example/',
      'http://mac.tail1.ts.net/',
      'https://mac.tail1.ts.net:8443/',
      'https://user@mac.tail1.ts.net/',
      'javascript:alert(1)',
      'file:///private/data',
    ]) {
      expect(allowedErpNavigation(base, Uri.parse(url)), false);
    }
  });

  test('connection status uses only its bounded device API and refuses redirects/revocation', () async {
    final link = Link('https://mac.tail1.ts.net', 'Workspace', 'status-only-secret');
    final client = MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.toString(), 'https://mac.tail1.ts.net/api/mobile/status');
      expect(request.headers['authorization'], 'Bearer status-only-secret');
      expect(request.followRedirects, false);
      return http.Response('{\"ok\":true,\"connectionOnly\":true}', 200);
    });
    await checkStatus(link, client: client);
    await expectLater(checkStatus(link, client: MockClient((_) async => http.Response('{}', 401))), throwsA(isA<NotLinked>()));
    await expectLater(checkStatus(link, client: MockClient((_) async => http.Response('', 302, headers: {'location': 'https://evil.example'}))), throwsException);
  });
}
