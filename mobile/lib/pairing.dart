import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

bool isTailscaleOrigin(Uri uri) =>
    uri.scheme == 'https' &&
    RegExp(r'^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ts\.net$', caseSensitive: false).hasMatch(uri.host) &&
    uri.userInfo.isEmpty && uri.port == 443 && (uri.path.isEmpty || uri.path == '/') &&
    !uri.hasQuery && !uri.hasFragment;

/// Web navigation is limited to the paired HTTPS origin, not all tailnet hosts.
bool allowedErpNavigation(Uri base, Uri destination) =>
    isTailscaleOrigin(base) && destination.scheme == 'https' &&
    destination.origin == base.origin && destination.userInfo.isEmpty;

Future<http.Response> _request(String method, Uri uri,
    {Map<String, String>? headers, String? body, http.Client? client}) async {
  final owned = client == null;
  final transport = client ?? http.Client();
  try {
    final request = http.Request(method, uri)..followRedirects = false;
    if (headers != null) request.headers.addAll(headers);
    if (body != null) request.body = body;
    return await http.Response.fromStream(await transport.send(request).timeout(const Duration(seconds: 15)));
  } finally {
    if (owned) transport.close();
  }
}

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
    if (uri == null || uri.scheme != 'bbn-pair' || uri.host != 'redeem' || uri.path.isNotEmpty) {
      throw const FormatException('This is not a BoomBigNose pairing code.');
    }
    final q = uri.queryParameters;
    final base = Uri.tryParse(q['u'] ?? '');
    final exp = int.tryParse(q['e'] ?? '');
    if (base == null || (q['t'] ?? '').isEmpty || exp == null) {
      throw const FormatException('The pairing code is incomplete.');
    }
    if (!isTailscaleOrigin(base)) {
      throw const FormatException(
          'The server must be a private HTTPS .ts.net origin with Tailscale Serve configured.');
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
  if (b == null || t == null || !isTailscaleOrigin(Uri.parse(b))) return null;
  return Link(b, await _storage.read(key: 'orgName') ?? '', t);
}

Future<void> clearLink() => _storage.deleteAll();

Future<Map<String, dynamic>> _json(http.Response r) async {
  if (r.statusCode == 401) throw NotLinked();
  if (r.statusCode != 200) throw const HttpException('Connection request failed. Check the server and pairing.');
  final body = jsonDecode(r.body) as Map<String, dynamic>;
  return body;
}

Map<String, String> _headers(String token) =>
    {'authorization': 'Bearer $token', 'content-type': 'application/json'};

/// Trades the QR token for a device token and stores it in the Keychain.
Future<Link> redeem(PairPayload p, String deviceName, {http.Client? client}) async {
  final r = await _request('POST', Uri.parse('${p.baseUrl}/api/mobile/pair/redeem'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'token': p.token, 'deviceName': deviceName}), client: client);
  final b = await _json(r);
  final link = Link(p.baseUrl, (b['orgName'] as String?)?.isNotEmpty == true ? b['orgName'] as String : p.orgName,
      b['deviceToken'] as String);
  await _storage.write(key: 'baseUrl', value: link.baseUrl);
  await _storage.write(key: 'orgName', value: link.orgName);
  await _storage.write(key: 'deviceToken', value: link.deviceToken);
  return link;
}

/// Connection status only; this token cannot log in to any ERP account.
Future<void> checkStatus(Link l, {http.Client? client}) async {
  if (!isTailscaleOrigin(Uri.parse(l.baseUrl))) throw const FormatException('Invalid private server origin.');
  await _json(await _request('GET', Uri.parse('${l.baseUrl}/api/mobile/status'),
      headers: _headers(l.deviceToken), client: client));
}

/// Opening ERP never sends a pairing credential or mints an account session.
Uri erpLoginUrl(Link link) {
  final base = Uri.parse(link.baseUrl);
  if (!isTailscaleOrigin(base)) throw const FormatException('Invalid private server origin.');
  return base.resolve('/login');
}
