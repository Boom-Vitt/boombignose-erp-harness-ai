// Settings › LINE: who answers, three setup steps, who may talk to BigNose, and the expert fields behind More options.
import type { Api } from '../api.ts';
import type { Agent, LineStatus, Settings } from '../types.ts';
import { btn, copyText, el, errMsg, field, formatTime, guarded, icon, load, toast } from '../dom.ts';
import { dirty } from './forms.ts';
import { agentSelect, saveBar, shortId, sw } from './parts.ts';

// names of the secrets in the daemon's .env
const ACCESS_NAME = 'LINE_CHANNEL_ACCESS_TOKEN';
const CHANNEL_NAME = 'LINE_CHANNEL_SECRET';
const KINDS: [key: 'users' | 'groups' | 'rooms', prefix: string, noun: string][] = [['users', 'U', 'user'], ['groups', 'C', 'group'], ['rooms', 'R', 'room']];
const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function ids(label: string, prefix: string, list: string[]): { box: HTMLTextAreaElement; root: HTMLElement; value(): string[] } {
  const box = el('textarea', { rows: 3, spellcheck: 'false', autocomplete: 'off', placeholder: `${prefix}…` });
  box.value = list.join('\n');
  return {
    box,
    root: field(label, box, `One ID per line, starting with ${prefix}`),
    value() {
      const out = lines(box.value);
      const bad = out.find((i) => !i.startsWith(prefix));
      if (bad) throw new Error(`${label}: "${bad}" does not start with ${prefix}`);
      return out;
    },
  };
}

export function mountMessaging(pane: HTMLElement, api: Api): void {
  const reload = () => void load(pane, () => Promise.all([api.getSettings(), api.lineStatus(), api.listAgents()]), ([s, st, a]) => render(s, st, a.agents));

  function render({ config }: Settings, first: LineStatus, agents: Agent[]): void {
    const line = config.line;
    let st = first;
    let connected = false; // Connect worked in this view

    // ---- who answers
    const enabled = sw('Answer LINE messages', line.enabled);
    const status = el('span', { class: 'badge' });
    const firstAgent = agents.find((a) => a.id === (st.agentId ?? line.agentId))?.id ?? agents[0]?.id ?? '';
    const answeredBy = agentSelect(agents, firstAgent);

    // ---- step 1: credentials (never shown, only replaced)
    const token = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Paste the channel access token' });
    const secret = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Paste the channel secret' });
    const creds = el('div', { hidden: true }, field('Channel access token', token), field('Channel secret', secret));
    const credsSub = el('div', { class: 'row-sub' });
    const paste = btn('Paste…', () => { creds.hidden = !creds.hidden; if (!creds.hidden) token.focus(); }, 'small');
    const step1 = el('span', { class: 'step' });
    const stepRow1 = el('div', { class: 'row' }, step1, el('div', { class: 'row-text' }, 'Paste the channel token and secret', credsSub), paste);

    // ---- step 2: webhook
    const connectResult = el('div', { class: 'row-sub line-connect-result', role: 'status' });
    const testResult = el('div', { class: 'row-sub line-test-result', role: 'status' });
    const connect = btn('Connect', (b) => void guarded(async () => {
      connectResult.replaceChildren();
      try {
        const result = await api.lineConnect();
        connected = result.ok;
        connectResult.replaceChildren(
          ...result.steps.map((s) => el('p', { class: s.ok ? 'muted' : 'notice error' }, `${s.name === 'token' ? 'Token' : 'Webhook'}: ${s.ok ? 'ok' : 'failed'} — ${s.detail}`)),
          ...(result.bot ? [el('p', {}, `${result.bot.displayName} (${result.bot.basicId})`)] : []));
        try { st = await api.lineStatus(); paint(); }
        catch (e) { connectResult.append(el('p', { class: 'notice error' }, errMsg(e))); }
      } catch (e) { connectResult.replaceChildren(el('p', { class: 'notice error' }, errMsg(e))); }
    }, b), 'small');
    const test = btn('Test webhook', (b) => void guarded(async () => {
      testResult.replaceChildren();
      try {
        const result = await api.lineTest();
        testResult.replaceChildren(el('p', { class: result.ok ? 'muted' : 'notice error' }, `Test: ${result.ok ? 'ok' : 'failed'}`),
          ...(result.statusCode !== undefined ? [el('p', {}, `LINE status code: ${result.statusCode}`)] : []),
          el('p', {}, result.detail));
      } catch (e) { testResult.replaceChildren(el('p', { class: 'notice error' }, errMsg(e))); }
    }, b), 'small');
    const webhookSub = el('div', { class: 'row-sub' });
    const copy = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Copy the webhook URL' }, icon('copy'));
    copy.addEventListener('click', () => { if (st.webhookUrl) copyText(st.webhookUrl); });
    const step2 = el('span', { class: 'step' });
    const stepRow2 = el('div', { class: 'row line-step' }, step2, el('div', { class: 'row-text' }, 'Connect the webhook', webhookSub, connectResult, testResult), copy, connect, test);

    // ---- step 3: who may talk to BigNose (the three lists below are the one source; the badges and Add… read and write them)
    const users = ids('Allowed users', 'U', line.allow.users);
    const groups = ids('Allowed groups', 'C', line.allow.groups);
    const rooms = ids('Allowed rooms', 'R', line.allow.rooms);
    const lists = { users, groups, rooms };
    const people = el('div', { class: 'people' });
    const peopleSub = el('div', { class: 'row-sub' });
    const addBox = el('input', { type: 'text', placeholder: 'U…, C… or R…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'LINE ID to allow' });
    const addRow = el('div', { class: 'row', hidden: true }, addBox, btn('Allow', () => {
      const id = addBox.value.trim(), kind = KINDS.find(([, prefix]) => id.startsWith(prefix) && id.length > 1);
      if (!kind) { toast('A LINE ID starts with U (a person), C (a group) or R (a room)', 'error'); return; }
      const box = lists[kind[0]].box;
      if (!lines(box.value).includes(id)) box.value = [...lines(box.value), id].join('\n');
      addBox.value = ''; addRow.hidden = true; paint(); refresh();
    }, 'small'));
    const addBtn = btn('Add…', () => { addRow.hidden = !addRow.hidden; if (!addRow.hidden) addBox.focus(); }, 'small');
    const warnings = el('div', { class: 'line-warnings' });
    const step3 = el('span', { class: 'step' });
    const stepRow3 = el('div', { class: 'row' }, step3, el('div', { class: 'row-text' }, 'Choose who may talk to BigNose', peopleSub, people), addBtn);

    // ---- Tried to reach you
    // shortcut: core does not send LineStatus.blocked yet (tested with a fake), so nothing shows until it does; drop this block if that never ships
    const blocked = (st.blocked ?? []).filter((b) => !KINDS.some(([key]) => lines(lists[key].box.value).includes(b.id)));
    async function allow(id: string, b: HTMLButtonElement): Promise<void> {
      const kind = KINDS.find(([, prefix]) => id.startsWith(prefix));
      await guarded(async () => {
        if (!kind) throw new Error(`${id} is not a LINE user, group or room ID`);
        await api.updateSettings((c) => { if (!c.line.allow[kind[0]].includes(id)) c.line.allow[kind[0]].push(id); });
        toast('Allowed');
        reload();
      }, b);
    }
    const triedRows = blocked.map((b) => el('div', { class: 'row' },
      el('div', { class: 'row-text' }, el('code', { class: 'id', title: b.id }, shortId(b.id)), el('div', { class: 'row-sub' }, `${b.kind} · ${formatTime(b.at)}`)),
      btn('Allow', (button) => void allow(b.id, button), 'small')));

    // ---- More options
    const publicUrl = el('input', { type: 'url', value: line.publicUrl ?? '', placeholder: 'https://your-tunnel.example.com', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'line-public-url-error' });
    const urlError = el('div', { id: 'line-public-url-error', class: 'notice error', role: 'alert', hidden: true });
    const urlField = field('Public address', publicUrl, 'A public HTTPS address (for example a tunnel) that forwards to the local port. LINE calls <address>/line/webhook.');
    urlField.append(urlError);
    function validateUrl(): boolean {
      const pub = publicUrl.value.trim();
      let error = '';
      if (pub) {
        if (!pub.startsWith('https://')) error = 'The public address must start with https://';
        else {
          try { new URL(pub); } catch { error = 'The public address is not a valid URL'; }
        }
      }
      urlError.textContent = error; urlError.hidden = !error;
      publicUrl.setAttribute('aria-invalid', String(!!error));
      return !error;
    }
    publicUrl.addEventListener('input', validateUrl);
    publicUrl.addEventListener('invalid', validateUrl);
    const port = el('input', { type: 'number', min: 1, max: 65535, value: line.port });
    const slow = el('input', { type: 'number', min: 1, max: 50, step: 1, value: String(line.slowResponseMs / 1000), 'aria-describedby': 'line-slow-error' });
    const slowError = el('div', { id: 'line-slow-error', class: 'notice error', role: 'alert', hidden: true });
    const slowField = field('“Still working” after (seconds)', slow, "Up to 50 seconds, so LINE's reply token is still valid.");
    slowField.append(slowError);
    function validateSlow(): boolean {
      const n = Number(slow.value);
      const valid = Number.isInteger(n) && n >= 1 && n <= 50;
      slowError.textContent = valid ? '' : 'Slow response must be a whole number between 1 and 50 seconds';
      slowError.hidden = valid;
      slow.setAttribute('aria-invalid', String(!valid));
      return valid;
    }
    slow.addEventListener('input', validateSlow);
    slow.addEventListener('invalid', validateSlow);
    const more = el('details', { class: 'card disclosure' },
      el('summary', {}, icon('chev-r'), 'More options', el('span', { class: 'row-sub' }, 'Address, port, timing, allowed lists')),
      el('div', {}, urlField, field('Local port', port, 'The gateway listens on 127.0.0.1 only.'), slowField, users.root, groups.root, rooms.root,
        el('p', { class: 'hint pad' }, 'Save does not prove the token or the tunnel work: use Connect and Test webhook.')));

    // ---- what the page says about the saved state
    function paint(): void {
      const ready = st.tokenSet && st.secretSet;
      const [tone, text] = !line.enabled ? ['', 'Off'] : st.running && ready && !st.warnings.length ? ['ok', 'Connected'] : ['warn', 'Needs setup'];
      status.className = `badge ${tone}`.trim(); status.textContent = text;
      step1.className = ready ? 'step done' : 'step'; step1.replaceChildren(...(ready ? [icon('check')] : ['1']));
      credsSub.textContent = ready ? 'Both saved.' : st.tokenSet || st.secretSet ? `${st.tokenSet ? 'The secret' : 'The token'} is not set.` : 'Not set';
      paste.textContent = ready || st.tokenSet || st.secretSet ? 'Replace…' : 'Paste…';
      connect.disabled = test.disabled = !ready;
      for (const b of [connect, test]) { if (ready) b.removeAttribute('title'); else b.setAttribute('title', 'Paste the token first'); }
      step2.className = connected ? 'step done' : 'step'; step2.replaceChildren(...(connected ? [icon('check')] : ['2']));
      webhookSub.replaceChildren(...(st.webhookUrl ? [el('code', {}, st.webhookUrl)] : ['Set the public address under More options first.']));
      copy.hidden = !st.webhookUrl;
      const all = KINDS.flatMap(([key]) => lists[key].box.value ? lines(lists[key].box.value) : []);
      step3.className = all.length ? 'step done' : 'step'; step3.replaceChildren(...(all.length ? [icon('check')] : ['3']));
      peopleSub.textContent = all.length ? '' : 'Nobody yet.';
      people.replaceChildren(...all.map((id) => el('span', { class: 'badge' }, el('code', { title: id }, shortId(id)))));
      warnings.replaceChildren(...st.warnings.map((w) => el('div', { class: 'notice warn' }, w)),
        ...(st.healthUrl ? [el('p', { class: 'hint' }, `Open ${st.healthUrl} in a browser to check your tunnel.`)] : []),
        ...(st.lastEventAt ? [el('p', { class: 'hint' }, `Last event: ${formatTime(st.lastEventAt)}`)] : []),
        ...(st.lastError ? [el('div', { class: 'notice error' }, st.lastError)] : []));
    }

    // ---- the save bar
    const now = (): Record<string, string> => ({
      'Answer LINE messages': enabled.checked ? 'On' : 'Off',
      'Answered by': answeredBy.value, // the id: agent names are not unique
      'Channel token': token.value.trim() ? 'replaced' : '', 'Channel secret': secret.value.trim() ? 'replaced' : '',
      'Public address': publicUrl.value.trim(), 'Local port': String(port.value), '“Still working” after': slow.value.trim(),
      'Allowed users': users.box.value.trim(), 'Allowed groups': groups.box.value.trim(), 'Allowed rooms': rooms.box.value.trim(),
    });
    const initial = now();
    const bar = saveBar(reload);
    const RESTART = ['Answer LINE messages', 'Local port', 'Channel token', 'Channel secret'];
    function refresh(): void {
      const agentName = (id = '') => agents.find((a) => a.id === id)?.name ?? '';
      const changes = dirty(initial, now(), { secret: ['Channel token', 'Channel secret'], hidden: ['Allowed users', 'Allowed groups', 'Allowed rooms'] })
        .map((c) => {
          if (c.label !== 'Answered by') return c;
          const [from, to] = [agentName(c.from), agentName(c.to)];
          return from === to ? { label: c.label } : { ...c, from, to }; // two agents may share a name
        });
      bar.set(changes, changes.some((c) => RESTART.includes(c.label)) ? ' · LINE will reconnect' : '');
    }

    const form = el('form', { class: 'line-form' },
      el('div', { class: 'card' },
        el('div', { class: 'row' }, el('div', { class: 'row-text' }, 'Answer LINE messages'), status, enabled),
        field('Answered by', answeredBy)),
      el('h2', { class: 'group-title' }, 'Set up in three steps'),
      el('div', { class: 'card' }, stepRow1, creds, stepRow2, stepRow3, addRow, warnings),
      ...(blocked.length ? [el('h2', { class: 'group-title' }, 'Tried to reach you'), el('div', { class: 'card' }, ...triedRows)] : []),
      el('p', { class: 'group-foot' }, st.blocked
        ? 'LINE never shows people their own ID. Ask them to message BigNose once: they show up here, and you can allow them.'
        : 'LINE never shows people their own ID. Yours is in the LINE Developers console, under Basic settings.'),
      more, bar.root);
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    paint();

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const urlValid = validateUrl(), slowValid = validateSlow();
      if (!urlValid || !slowValid) { more.open = true; return; }
      const slowResponseMs = Number(slow.value) * 1000;
      void guarded(async () => {
        const p = Number(port.value);
        if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('Port must be between 1 and 65535');
        const pub = publicUrl.value.trim();
        const allowed = { users: users.value(), groups: groups.value(), rooms: rooms.value() };
        if (token.value.trim()) await api.putSecret(ACCESS_NAME, token.value.trim());
        if (secret.value.trim()) await api.putSecret(CHANNEL_NAME, secret.value.trim());
        await api.updateSettings((c) => {
          c.line.enabled = enabled.checked;
          if (answeredBy.value !== firstAgent) c.line.agentId = answeredBy.value;
          c.line.port = p;
          c.line.slowResponseMs = slowResponseMs;
          if (pub) c.line.publicUrl = pub; else delete c.line.publicUrl;
          c.line.allow = allowed;
        });
        toast('Saved');
        reload();
      }, bar.submit);
    });

    pane.append(form);
  }

  reload();
}
