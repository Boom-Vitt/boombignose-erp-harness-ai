import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.ts';
import { mountMessaging } from '../src/settings/messaging.ts';
import { agent, config } from './agent-fixture.ts';
import { TestNode, installDom, json, flush } from './dom-fixture.ts';
import type { LineStatus } from '../src/types.ts';

const button = (node: TestNode, label: string) => node.querySelectorAll('button').find(b => b.textContent === label)!;
const control = (node: TestNode, label: string) => {
  const field = node.querySelectorAll('.field').find(f => f.querySelector('.field-label')?.textContent === label);
  assert.ok(field, `Missing field: ${label}`);
  return field.querySelector('input') ?? field.querySelector('textarea') ?? field.querySelector('select')!;
};
const type = (form: TestNode, field: TestNode, value: string) => { field.value = value; field.fire('input'); form.fire('input'); };
const status: LineStatus = {
  enabled: true, running: true, port: 47822, tokenSet: true, secretSet: true, agentId: 'a1',
  publicUrl: 'https://tunnel.example', webhookUrl: 'https://tunnel.example/line/webhook',
  healthUrl: 'https://tunnel.example/line/webhook/health', warnings: ['Nobody is allowed yet: add your LINE user ID (U…) under Allowed users.'],
};

function harness(connect: () => Response | Promise<Response> = () => json({ ok: true, steps: [] }),
  webhookTest: () => Response | Promise<Response> = () => json({ ok: true, running: true, statusCode: 200, detail: 'OK' }),
  lineStatus: LineStatus = status, slowResponseMs = 45000, secondName = 'สอง') {
  let stored = structuredClone(config);
  stored.line = { ...stored.line, enabled: lineStatus.enabled, port: lineStatus.port, publicUrl: lineStatus.publicUrl, slowResponseMs };
  const calls: { path: string; method: string; body: any; headers: Record<string, string> }[] = [];
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const path = new URL(String(url)).pathname, method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method, body, headers: init?.headers as Record<string, string> });
    if (path === '/api/settings') { if (method === 'PUT') stored = body.config; return json({ config: stored, secrets: {} }); }
    if (path === '/api/secrets') return json({ name: body.name, masked: '••••' });
    if (path === '/api/agents') return json({ agents: [agent, { ...agent, id: 'a2', name: secondName }] });
    if (path === '/api/line/status') return json(lineStatus);
    if (path === '/api/line/connect') return connect();
    if (path === '/api/line/test') return webhookTest();
    assert.fail(`Unexpected request: ${method} ${path}`);
  }) as typeof fetch });
  const pane = new TestNode('div');
  return { api, pane, calls, config: () => stored };
}

async function mount(h: ReturnType<typeof harness>) {
  mountMessaging(h.pane as unknown as HTMLElement, h.api); await flush();
  return h.pane.querySelector('form')!;
}

test('the LINE page says Connected, Needs setup or Off, shows the three steps, the webhook URL and the warnings', async t => {
  t.after(installDom());
  const badgeText = (h: ReturnType<typeof harness>) => h.pane.querySelectorAll('.badge').map(b => b.textContent);
  const needs = harness(); await mount(needs);
  assert.ok(badgeText(needs).includes('Needs setup'), 'a warning means it is not ready yet');
  assert.ok(needs.pane.textContent.includes(status.warnings[0]!));
  assert.ok(needs.pane.textContent.includes('Open https://tunnel.example/line/webhook/health in a browser to check your tunnel.'));
  assert.deepEqual(needs.pane.querySelectorAll('.step').map(s => `${s.className}:${s.textContent}`), ['step done:', 'step:2', 'step:3']);
  assert.equal(needs.pane.querySelectorAll('code').find(c => c.textContent === status.webhookUrl) !== undefined, true);
  assert.equal(button(needs.pane, 'Replace…').textContent, 'Replace…');
  assert.ok(needs.pane.textContent.includes('Both saved.'));
  assert.equal(needs.pane.querySelectorAll('details').length, 1, 'one More options fold');
  const ready = harness(undefined, undefined, { ...status, warnings: [] }); await mount(ready);
  assert.ok(badgeText(ready).includes('Connected'));
  const off = harness(undefined, undefined, { ...status, enabled: false, running: false }); await mount(off);
  assert.ok(badgeText(off).includes('Off'));
  const fresh = harness(undefined, undefined, { ...status, tokenSet: false, secretSet: false }); await mount(fresh);
  assert.equal(button(fresh.pane, 'Paste…').textContent, 'Paste…', 'never "Replace" when nothing is set');
  assert.ok(fresh.pane.textContent.includes('Not set'));
  assert.equal(button(fresh.pane, 'Connect').disabled, true); assert.equal(button(fresh.pane, 'Test webhook').disabled, true);
  assert.equal(button(fresh.pane, 'Connect').attrs.title, 'Paste the token first');
});

test('Connect displays both successful steps and bot identity using the authenticated POST route', async t => {
  t.after(installDom());
  const h = harness(() => json({ ok: true, bot: { displayName: 'My bot <script>', basicId: '@my-bot' }, webhookUrl: status.webhookUrl,
    steps: [{ name: 'token', ok: true, detail: 'Connected' }, { name: 'webhook', ok: true, detail: 'Webhook set' }] }));
  await mount(h); button(h.pane, 'Connect').fire('click'); await flush();
  const result = h.pane.querySelector('.line-connect-result')!;
  assert.match(result.textContent, /Token: ok — Connected/);
  assert.match(result.textContent, /Webhook: ok — Webhook set/);
  assert.ok(result.textContent.includes('My bot <script> (@my-bot)'));
  assert.equal(result.querySelector('script'), null);
  const call = h.calls.find(c => c.path === '/api/line/connect')!;
  assert.equal(call.method, 'POST'); assert.deepEqual(call.body, {});
  assert.equal(call.headers.Authorization, 'Bearer test-token');
  assert.equal(h.calls.filter(c => c.path === '/api/line/status').length, 2);
  assert.equal(h.pane.querySelectorAll('.step')[1]!.className, 'step done', 'step 2 is done after a good Connect');
  h.api.lineStatus = async () => { throw new Error('Status unavailable'); };
  button(h.pane, 'Connect').fire('click'); await flush();
  assert.match(result.textContent, /Token: ok.*Webhook set/);
  assert.match(result.textContent, /Status unavailable/);
});

for (const tokenOk of [true, false]) test(`Connect shows failed webhook and ${tokenOk ? 'successful' : 'failed'} token steps`, async t => {
  t.after(installDom());
  const h = harness(() => json({ ok: false, ...(tokenOk ? { bot: { displayName: 'Bot', basicId: '@bot' } } : {}), steps: [
    { name: 'token', ok: tokenOk, detail: tokenOk ? 'Connected' : 'Save the channel access token first.' },
    { name: 'webhook', ok: false, detail: tokenOk ? 'Set a public HTTPS URL first.' : 'Fix the token first.' },
  ] }));
  await mount(h); button(h.pane, 'Connect').fire('click'); await flush();
  const text = h.pane.querySelector('.line-connect-result')!.textContent;
  assert.ok(text.includes(`Token: ${tokenOk ? 'ok' : 'failed'}`));
  assert.ok(text.includes('Webhook: failed'));
  assert.ok(text.includes(tokenOk ? 'Set a public HTTPS URL first.' : 'Fix the token first.'));
  if (tokenOk) assert.ok(text.includes('Bot (@bot)'));
  else assert.ok(text.includes('Save the channel access token first.'));
  assert.equal(h.pane.querySelectorAll('.step')[1]!.textContent, '2');
});

for (const ok of [true, false]) test(`Test webhook displays LINE's ${ok ? 'success' : 'failure'} code and detail`, async t => {
  t.after(installDom());
  const h = harness(undefined, () => json({ ok, running: true, statusCode: ok ? 200 : 401, reason: 'Reason', detail: '<script>Detail</script>' }));
  await mount(h); button(h.pane, 'Test webhook').fire('click'); await flush();
  const result = h.pane.querySelector('.line-test-result')!;
  assert.ok(result.textContent.includes(`LINE status code: ${ok ? 200 : 401}`));
  assert.ok(result.textContent.includes('<script>Detail</script>'));
  assert.equal(result.querySelector('script'), null);
  const call = h.calls.find(c => c.path === '/api/line/test')!;
  assert.equal(call.method, 'POST'); assert.deepEqual(call.body, {});
  assert.equal(call.headers.Authorization, 'Bearer test-token');
});

test('Test webhook shows the actionable listener-off response without inventing a status code', async t => {
  t.after(installDom());
  const detail = 'The LINE listener is not running. Turn LINE on, save, then test again.';
  const h = harness(undefined, () => json({ ok: false, running: false, detail }));
  await mount(h); button(h.pane, 'Test webhook').fire('click'); await flush();
  const text = h.pane.querySelector('.line-test-result')!.textContent;
  assert.ok(text.includes(detail)); assert.ok(!text.includes('status code'));
});

for (const label of ['Connect', 'Test webhook']) test(`${label} is disabled while pending and recovers after an error`, async t => {
  t.after(installDom());
  const pending = Promise.withResolvers<Response>(); let request = 0;
  const run = () => ++request === 1 ? pending.promise : json(label === 'Connect'
    ? { ok: true, steps: [{ name: 'token', ok: true, detail: 'Recovered' }, { name: 'webhook', ok: true, detail: 'Set' }] }
    : { ok: true, running: true, statusCode: 200, detail: 'Recovered' });
  const h = harness(label === 'Connect' ? run : undefined, label === 'Test webhook' ? run : undefined);
  await mount(h); const action = button(h.pane, label); action.fire('click'); await flush();
  assert.equal(action.disabled, true);
  pending.resolve(json({ error: 'Request failed' }, 500)); await flush();
  assert.equal(action.disabled, false);
  assert.match(h.pane.querySelector(label === 'Connect' ? '.line-connect-result' : '.line-test-result')!.textContent, /Request failed/);
  action.fire('click'); await flush(); assert.equal(action.disabled, false);
  assert.match(h.pane.querySelector(label === 'Connect' ? '.line-connect-result' : '.line-test-result')!.textContent, /Recovered/);
});

test('the LINE page chooses which agent answers', async t => {
  t.after(installDom());
  const h = harness(); const form = await mount(h);
  const answeredBy = control(form, 'Answered by');
  assert.deepEqual(answeredBy.querySelectorAll('option').map(o => o.value), ['a1', 'a2'], 'every agent is listed');
  assert.equal(answeredBy.querySelectorAll('option')[1]!.attrs.lang, 'th', 'a Thai name is tagged');
  assert.equal(answeredBy.value, 'a1', 'the agent that answers now is selected');
  form.fire('submit'); await flush();
  assert.equal(h.config().line.agentId, undefined, 'nothing changed, so the choice is not written');
  type(form, answeredBy, 'a2');
  assert.equal(form.querySelector('.save-bar-text')!.textContent, 'Answered by changed from One to สอง');
  form.fire('submit'); await flush();
  assert.equal(h.config().line.agentId, 'a2');
  assert.equal(h.calls.filter(c => c.method === 'PUT').length, 2, 'one save per submit');
});

test('two agents with the same name: choosing the other one still shows the save bar and saves its id', async t => {
  t.after(installDom());
  const h = harness(undefined, undefined, status, 45000, 'One'); const form = await mount(h);
  type(form, control(form, 'Answered by'), 'a2');
  assert.equal(form.querySelector('.save-bar')!.hidden, false);
  assert.equal(form.querySelector('.save-bar-text')!.textContent, 'Answered by changed');
  form.fire('submit'); await flush();
  assert.equal(h.config().line.agentId, 'a2');
});

test('the save bar names what changed and says LINE will reconnect only for the fields that restart it', async t => {
  t.after(installDom());
  const h = harness(); const form = await mount(h);
  const text = () => form.querySelector('.save-bar-text')!.textContent;
  assert.equal(form.querySelector('.save-bar')!.hidden, true);
  type(form, control(form, 'Public address'), 'https://other.example');
  assert.equal(text(), 'Public address changed from https://tunnel.example to https://other.example');
  assert.ok(!text().includes('reconnect'), 'a live field does not restart LINE');
  type(form, control(form, 'Channel access token'), 'paste-me-123');
  assert.equal(text(), 'Channel token and Public address changed · LINE will reconnect'); assert.ok(!form.textContent.includes('paste-me-123'));
  type(form, control(form, 'Public address'), 'https://tunnel.example');
  assert.equal(text(), 'Channel token replaced · LINE will reconnect');
  type(form, control(form, 'Channel access token'), '');
  assert.equal(form.querySelector('.save-bar')!.hidden, true);
  const on = form.querySelectorAll('input').find(i => i.className.includes('switch'))!;
  on.checked = false; on.fire('change'); form.fire('change');
  assert.equal(text(), 'Answer LINE messages changed from On to Off · LINE will reconnect');
});

test('Tried to reach you lists senders the allowlist turned away, and Allow saves them to the matching list', async t => {
  t.after(installDom());
  const h = harness(undefined, undefined, { ...status, blocked: [{ id: 'Ustranger', kind: 'user', at: Date.now() }, { id: 'Cgroup', kind: 'group', at: Date.now() }] });
  await mount(h);
  assert.ok(h.pane.textContent.includes('Tried to reach you'));
  const rows = h.pane.querySelectorAll('.row').filter(r => r.querySelector('code')?.textContent === 'Ustranger');
  assert.equal(rows.length, 1);
  button(rows[0]!, 'Allow').fire('click'); await flush();
  assert.deepEqual(h.config().line.allow.users, ['Ustranger']);
  const quiet = harness(); await mount(quiet);
  assert.ok(!quiet.pane.textContent.includes('Tried to reach you'), 'hidden until the core reports blocked senders');
});

test('Add… allows an ID in the list its first letter names, and refuses anything else', async t => {
  t.after(installDom());
  const h = harness(); const form = await mount(h);
  const input = form.querySelectorAll('input').find(i => i.attrs['aria-label'] === 'LINE ID to allow')!;
  button(form, 'Add…').fire('click');
  input.value = 'Rroom1'; button(form, 'Allow').fire('click');
  assert.equal(control(form, 'Allowed rooms').value, 'Rroom1');
  assert.deepEqual(form.querySelector('.people')!.querySelectorAll('.badge').map(b => b.textContent), ['Rroom1']);
  form.fire('submit'); await flush();
  assert.deepEqual(h.config().line.allow, { users: [], groups: [], rooms: ['Rroom1'] });
});

test('public address rejects HTTP and malformed input inline before saving settings or secrets', async t => {
  t.after(installDom());
  const h = harness(); const form = await mount(h);
  control(form, 'Channel access token').value = 'fake-token';
  for (const url of ['http://tunnel.example', 'ftp://tunnel.example', 'https://']) {
    const publicUrl = control(form, 'Public address'); publicUrl.value = url; publicUrl.fire('input');
    form.fire('submit'); await flush();
    assert.ok(!h.calls.some(c => c.method === 'PUT'));
    assert.equal(publicUrl.attrs['aria-invalid'], 'true');
    assert.ok(form.querySelectorAll('.error').some(n => !n.hidden && /public address/.test(n.textContent)));
  }
  const publicUrl = control(form, 'Public address'); publicUrl.value = 'https://valid.example'; publicUrl.fire('input');
  form.fire('submit'); await flush();
  assert.equal(h.config().line.publicUrl, 'https://valid.example');
});

test('slow response is edited in seconds and saved in milliseconds with 1-50 bounds', async t => {
  t.after(installDom());
  const label = '“Still working” after (seconds)';
  for (const [ms, seconds] of [[1000, '1'], [45000, '45'], [50000, '50']] as const) {
    const h = harness(undefined, undefined, status, ms); const form = await mount(h);
    assert.equal(control(form, label).value, seconds);
    assert.ok(form.textContent.includes("Up to 50 seconds, so LINE's reply token is still valid."));
    form.fire('submit'); await flush(); assert.equal(h.config().line.slowResponseMs, ms);
  }
  const h = harness(); const form = await mount(h);
  const slow = control(form, label);
  for (const value of ['0', '51', '1.5', '', 'invalid']) {
    slow.value = value; slow.fire('input'); form.fire('submit'); await flush();
    assert.ok(!h.calls.some(c => c.method === 'PUT'));
    assert.equal(slow.attrs['aria-invalid'], 'true');
    assert.ok(form.querySelectorAll('.error').some(n => !n.hidden && /1.*50/.test(n.textContent)));
  }
  slow.value = '12'; slow.fire('input'); form.fire('submit'); await flush();
  assert.equal(h.config().line.slowResponseMs, 12000);
  assert.equal(control(h.pane, label).value, '12');
});

test('native URL validation displays the inline error when it prevents form submission', async t => {
  t.after(installDom());
  const h = harness(); const form = await mount(h);
  const publicUrl = control(form, 'Public address'); publicUrl.value = 'https://'; publicUrl.fire('invalid');
  assert.equal(publicUrl.attrs['aria-invalid'], 'true');
  assert.ok(form.querySelectorAll('.error').some(n => !n.hidden && /public address/.test(n.textContent)));
});

test('saving keeps the validated slow-response value while a settings request is pending', async t => {
  t.after(installDom());
  const pending = Promise.withResolvers<Response>(); let stored = structuredClone(config);
  stored.line.port = 47822;
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/line/status') return json(status);
    if (path === '/api/agents') return json({ agents: [agent] });
    if (path === '/api/settings') {
      if (init?.method === 'PUT') stored = JSON.parse(String(init.body)).config;
      return json({ config: stored, secrets: {} });
    }
    if (path === '/api/secrets') return pending.promise;
    assert.fail(path);
  }) as typeof fetch });
  const pane = new TestNode('div'); mountMessaging(pane as unknown as HTMLElement, api); await flush();
  const form = pane.querySelector('form')!; control(form, 'Channel access token').value = 'fake-token';
  const slow = control(form, '“Still working” after (seconds)'); slow.value = '12';
  form.fire('submit'); await flush();
  assert.equal(button(form, 'Save').disabled, true);
  slow.value = '0'; pending.resolve(json({ masked: '••••' })); await flush();
  assert.equal(stored.line.slowResponseMs, 12000);
});
