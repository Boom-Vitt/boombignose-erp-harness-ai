import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

/// What the pairing QR carries: a one-time token, never a password or a session.
class PairPayload {
  PairPayload(this.baseUrl, this.token, this.orgName, this.expires);
  final String baseUrl;
  final String token;
  final String orgName;
  final DateTime expires;

  /// Parses `bbn-pair://redeem?u=<https base>&t=<token>&o=<org>&e=<unix secs>`.
  /// Throws [FormatException] with a message fit to show the user.
  static PairPayload parse(String raw, {DateTime? now}) {
    final uri = Uri.tryParse(raw.trim());
    if (uri == null || uri.scheme != 'bbn-pair') {
      throw const FormatException('This is not a BoomBigNose pairing code.');
    }
    final q = uri.queryParameters;
    final base = Uri.tryParse(q['u'] ?? '');
    final exp = int.tryParse(q['e'] ?? '');
    if (base == null || (q['t'] ?? '').isEmpty || exp == null) {
      throw const FormatException('The pairing code is incomplete.');
    }
    if (base.scheme != 'https' || base.host.isEmpty) {
      throw const FormatException(
          'The server address must be https. On the computer run: tailscale serve --bg 3100');
    }
    final expires = DateTime.fromMillisecondsSinceEpoch(exp * 1000, isUtc: true);
    if (!expires.isAfter((now ?? DateTime.now()).toUtc())) {
      throw const FormatException('The pairing code has expired. Generate a new one.');
    }
    return PairPayload(base.origin, q['t']!, q['o'] ?? '', expires);
  }
}

/// A linked device: server address, org label and the long-lived device token.
class Link {
  Link(this.baseUrl, this.orgName, this.deviceToken);
  final String baseUrl;
  final String orgName;
  final String deviceToken;
}

class NotLinked implements Exception {}

const _storage = FlutterSecureStorage();

Future<Link?> loadLink() async {
  final b = await _storage.read(key: 'baseUrl');
  final t = await _storage.read(key: 'deviceToken');
  if (b == null || t == null) return null;
  return Link(b, await _storage.read(key: 'orgName') ?? '', t);
}

Future<void> clearLink() => _storage.deleteAll();

Future<Map<String, dynamic>> _json(http.Response r) async {
  final body = jsonDecode(r.body) as Map<String, dynamic>;
  if (r.statusCode == 401) throw NotLinked();
  if (r.statusCode != 200) throw HttpException(body['error']?.toString() ?? 'Server error ${r.statusCode}');
  return body;
}

Map<String, String> _headers(String token) =>
    {'authorization': 'Bearer $token', 'content-type': 'application/json'};

/// Trades the QR token for a device token and stores it in the Keychain.
Future<Link> redeem(PairPayload p, String deviceName) async {
  final r = await http
      .post(Uri.parse('${p.baseUrl}/api/mobile/pair/redeem'),
          headers: {'content-type': 'application/json'},
          body: jsonEncode({'token': p.token, 'deviceName': deviceName}))
      .timeout(const Duration(seconds: 15));
  final b = await _json(r);
  final link = Link(p.baseUrl, (b['orgName'] as String?)?.isNotEmpty == true ? b['orgName'] as String : p.orgName,
      b['deviceToken'] as String);
  await _storage.write(key: 'baseUrl', value: link.baseUrl);
  await _storage.write(key: 'orgName', value: link.orgName);
  await _storage.write(key: 'deviceToken', value: link.deviceToken);
  return link;
}

/// Throws [NotLinked] when the device was revoked.
Future<void> checkStatus(Link l) async => _json(await http
    .get(Uri.parse('${l.baseUrl}/api/mobile/status'), headers: _headers(l.deviceToken))
    .timeout(const Duration(seconds: 10)));

/// One-time URL that signs the WebView in to the ERP.
Future<Uri> sessionUrl(Link l) async {
  final b = await _json(await http
      .post(Uri.parse('${l.baseUrl}/api/mobile/session'), headers: _headers(l.deviceToken))
      .timeout(const Duration(seconds: 15)));
  return Uri.parse('${l.baseUrl}${b['path']}');
}
