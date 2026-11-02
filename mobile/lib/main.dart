import 'dart:io';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'pairing.dart';

void main() => runApp(const BbnApp());

class BbnApp extends StatelessWidget {
  const BbnApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'BoomBigNose',
        theme: ThemeData(colorSchemeSeed: const Color(0xFFE8590C), useMaterial3: true),
        home: const Gate(),
      );
}

/// Onboarding until a device token is stored, then Home.
class Gate extends StatefulWidget {
  const Gate({super.key});
  @override
  State<Gate> createState() => _GateState();
}

class _GateState extends State<Gate> {
  late Future<Link?> _link = loadLink();
  void _reload() => setState(() => _link = loadLink());

  @override
  Widget build(BuildContext context) => FutureBuilder<Link?>(
        future: _link,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Scaffold(body: Center(child: CircularProgressIndicator()));
          }
          final link = snap.data;
          return link == null
              ? Onboarding(onPaired: _reload)
              : Home(link: link, onUnlinked: _reload);
        },
      );
}

class Onboarding extends StatefulWidget {
  const Onboarding({super.key, required this.onPaired});
  final VoidCallback onPaired;
  @override
  State<Onboarding> createState() => _OnboardingState();
}

class _OnboardingState extends State<Onboarding> {
  final _scanner = MobileScannerController(formats: [BarcodeFormat.qrCode]);
  bool _busy = false;
  String? _error;

  Future<void> _onCode(BarcodeCapture c) async {
    final raw = c.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
    if (_busy || raw == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await redeem(PairPayload.parse(raw), Platform.localHostname);
      widget.onPaired();
    } on FormatException catch (e) {
      _fail(e.message);
    } on HttpException catch (e) {
      _fail(e.message);
    } catch (_) {
      _fail('Could not reach the server. Is Tailscale connected on this phone and the computer?');
    }
  }

  void _fail(String message) {
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = message;
    });
  }

  @override
  void dispose() {
    _scanner.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Link to BoomBigNose')),
        body: Column(children: [
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text('On the computer open Settings → Link mobile → Generate QR, '
                'then scan it here. Both devices must be on the same Tailscale network.'),
          ),
          Expanded(child: MobileScanner(controller: _scanner, onDetect: _onCode)),
          if (_busy) const LinearProgressIndicator(),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
        ]),
      );
}

enum _Conn { checking, connected, offline, revoked }

class Home extends StatefulWidget {
  const Home({super.key, required this.link, required this.onUnlinked});
  final Link link;
  final VoidCallback onUnlinked;
  @override
  State<Home> createState() => _HomeState();
}

class _HomeState extends State<Home> {
  _Conn _conn = _Conn.checking;

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    setState(() => _conn = _Conn.checking);
    try {
      await checkStatus(widget.link);
      if (mounted) setState(() => _conn = _Conn.connected);
    } on NotLinked {
      if (mounted) setState(() => _conn = _Conn.revoked);
    } catch (_) {
      if (mounted) setState(() => _conn = _Conn.offline);
    }
  }

  Future<void> _unlink() async {
    await clearLink();
    widget.onUnlinked();
  }

  Future<void> _open() async {
    try {
      final url = await sessionUrl(widget.link);
      if (!mounted) return;
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ErpView(url: url)));
    } on NotLinked {
      if (mounted) setState(() => _conn = _Conn.revoked);
    } catch (_) {
      if (mounted) setState(() => _conn = _Conn.offline);
    }
  }

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (_conn) {
      _Conn.checking => ('Checking…', Colors.grey),
      _Conn.connected => ('Connected over Tailscale', Colors.green),
      _Conn.offline => ('Server unreachable — check Tailscale', Colors.orange),
      _Conn.revoked => ('This phone was unlinked from the server', Colors.red),
    };
    return Scaffold(
      appBar: AppBar(title: Text(widget.link.orgName.isEmpty ? 'BoomBigNose' : widget.link.orgName)),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          ListTile(
            leading: Icon(Icons.circle, color: color, size: 16),
            title: Text(label),
            subtitle: Text(widget.link.baseUrl),
          ),
          const SizedBox(height: 16),
          FilledButton(
              onPressed: _conn == _Conn.connected ? _open : null, child: const Text('Open ERP')),
          TextButton(onPressed: _check, child: const Text('Retry')),
          const Spacer(),
          OutlinedButton(onPressed: _unlink, child: const Text('Unlink this phone')),
        ]),
      ),
    );
  }
}

class ErpView extends StatefulWidget {
  const ErpView({super.key, required this.url});
  final Uri url;
  @override
  State<ErpView> createState() => _ErpViewState();
}

class _ErpViewState extends State<ErpView> {
  late final WebViewController _web = WebViewController()
    ..setJavaScriptMode(JavaScriptMode.unrestricted)
    ..loadRequest(widget.url);

  @override
  Widget build(BuildContext context) =>
      Scaffold(appBar: AppBar(title: const Text('ERP')), body: SafeArea(child: WebViewWidget(controller: _web)));
}
