// App shell: asks the Rust side for the daemon, then wires Chat, Settings and the event stream.
import { createApi } from './api.ts';
import type { Api } from './api.ts';
import { mountAgentForm, mountAgents } from './agents.ts';
import { createChat } from './chat.ts';
import { appIcon, btn, el, errMsg, freshHost, icon, toast } from './dom.ts';
import { provisionErp } from './os/erp-setup.ts';
import type { OsInfo } from './os/erp-setup.ts';
import { waitForReady, waitForStop } from './os/startup.ts';
import { streamEvents } from './sse.ts';
import { mountStage } from './stage.ts';
import type { ApiEvent } from './types.ts';
import { mountMemory } from './settings/memory.ts';
import { mountMessaging } from './settings/messaging.ts';
import { mountModel } from './settings/providers.ts';
import { mountSchedules } from './settings/schedules.ts';
import { mountTools } from './settings/tools.ts';

interface DaemonInfo { port: number; token: string; spawned: boolean }
declare global {
  interface Window {
    __TAURI__?: { core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> } };
    /** Set by the BoomBigNose window: this page is the panel beside the ERP. */
    __BIGNOSE_OS__?: boolean;
  }
}
const OS = window.__BIGNOSE_OS__ === true;

// The five Settings tabs. A tab mounts into a fresh element each time, so a late load from a tab the user left cannot draw over the new one.
const SECTIONS: { id: string; label: string; mount: (pane: HTMLElement, api: Api, query: URLSearchParams, agentsChanged: () => void) => void }[] = [
  { id: 'model', label: 'Model', mount: (pane, api, _query, changed) => mountModel(pane, api, changed) },
  { id: 'line', label: 'LINE', mount: (pane, api) => mountMessaging(pane, api) },
  { id: 'tools', label: 'Tools', mount: (pane, api) => mountTools(pane, api) },
  { id: 'memory', label: 'Memory', mount: (pane, api) => mountMemory(pane, api) },
  { id: 'schedules', label: 'Schedules', mount: (pane, api, query) => mountSchedules(pane, api, query.get('agent') ?? undefined) },
];

// Old settings routes land on the tab that holds their page now.
const ALIASES: Record<string, string> = { general: 'model', providers: 'model', connectors: 'tools', hooks: 'tools', skills: 'tools', messaging: 'line' };

mountStage();
const app = document.getElementById('app') as HTMLElement;
let events: AbortController | null = null;
let launcherWatch: AbortController | null = null;

function splash(text: string): HTMLElement {
  return el('div', { class: 'splash', role: 'status' }, appIcon(), el('p', {}, text));
}

function failure(message: string): HTMLElement {
  return el('div', { class: 'splash', role: 'alert' }, appIcon(),
    el('h1', {}, "BigNose couldn't start"), el('p', { class: 'error-text' }, message),
    btn('Try again', () => void boot(), 'primary'),
    el('p', { class: 'muted' }, 'The log is in ~/.bignose/logs/daemon.log.'));
}

async function boot(): Promise<void> {
  events?.abort();
  events = null;
  launcherWatch?.abort();
  launcherWatch = null;
  app.replaceChildren(splash('Starting BigNose…'));
  let api: Api;
  let erpAgent: string | undefined;
  try {
    const invoke = window.__TAURI__?.core.invoke;
    if (!invoke) throw new Error('This page only works inside the BigNose app.');
    // BoomBigNose: the window shows the startup screen until the ERP answers, then this page becomes the side panel
    if (OS) await waitForReady(invoke, (view) => app.replaceChildren(view));
    const info = await invoke<DaemonInfo>('daemon_info');
    api = createApi({ port: info.port, token: info.token });
    await api.health(); // proves the token and the webview's access to the daemon
    if (OS) erpAgent = await setUpErp(api, invoke);
  } catch (e) {
    app.replaceChildren(failure(errMsg(e)));
    return;
  }
  shell(api, erpAgent);
  if (OS) {
    // the launcher is watched after Ready too: when the ERP server exits, boot() shows why with Retry and returns here once it is back
    const invoke = window.__TAURI__!.core.invoke, watch = launcherWatch = new AbortController();
    void waitForStop(invoke, watch.signal).then((status) => { if (status && launcherWatch === watch) void boot(); });
  }
}

/** The panel still works without the ERP assistant, so a failed setup is a message, not a stop. */
async function setUpErp(api: Api, invoke: NonNullable<Window['__TAURI__']>['core']['invoke']): Promise<string | undefined> {
  try {
    return await provisionErp(api, await invoke<OsInfo>('os_info'));
  } catch (e) {
    toast(`ERP assistant setup failed: ${errMsg(e)}`, 'error');
    return undefined;
  }
}

function panelToggle(): HTMLElement {
  const b = el('button', { type: 'button', class: 'panel-toggle', title: 'Show or hide the BigNose panel (Cmd+J)', 'aria-label': 'Show or hide the BigNose panel' },
    el('span', { class: 'toggle-open', 'aria-hidden': 'true' }, '›'), el('span', { class: 'toggle-rail', 'aria-hidden': 'true' }, '‹ BigNose'));
  b.addEventListener('click', () => { void window.__TAURI__?.core.invoke('os_toggle_panel').catch((e: unknown) => toast(errMsg(e), 'error')); });
  return b;
}

function shell(api: Api, erpAgent?: string): void {
  let nav = () => {}; // set below; createChat reports its first view while it is still being built
  const chat = createChat(api, undefined, () => nav());
  const agents = el('section', { class: 'settings', 'aria-label': 'Agents' });
  const settings = el('section', { class: 'settings', 'aria-label': 'Settings' });
  const conn = el('div', { class: 'nav-conn', role: 'status' });
  const banner = el('div', { class: 'banner', role: 'alert', hidden: true },
    el('span', {}, 'Lost the connection to BigNose. Trying again…'), btn('Retry now', () => void boot(), 'small'));

  const link = (href: string, text: string, name: string, kbd?: string) =>
    el('a', { href, class: 'nav-link' }, icon(name), el('span', { class: 'nav-label' }, text), kbd && el('kbd', {}, kbd));
  const newChatLink = link('#/chat', 'New chat', 'plus', '⌘N');
  newChatLink.addEventListener('click', () => chat.newChat());
  const agentsLink = link('#/agents', 'Agents', 'agents');
  const settingsLink = link('#/settings/model', 'Settings', 'sliders');

  const tabs = SECTIONS.map((s) => {
    const t = el('button', { type: 'button', class: 'tab', role: 'tab', id: `tab-${s.id}`, 'aria-controls': 'settings-panel', 'aria-selected': 'false', tabindex: '-1' }, s.label);
    t.addEventListener('click', () => { location.hash = `#/settings/${s.id}`; });
    return t;
  });
  const tablist = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Settings sections' }, ...tabs);
  tablist.addEventListener('keydown', (ev) => {
    const at = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const to = ev.key === 'ArrowRight' ? at + 1 : ev.key === 'ArrowLeft' ? at - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : null;
    if (to === null) return;
    ev.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length]!;
    location.hash = `#/settings/${next.id.slice(4)}`;
    next.focus();
  });
  let panel = el('div', { id: 'settings-panel', role: 'tabpanel' });
  settings.append(el('div', { class: 'page-head' }, el('h1', {}, 'Settings')), tablist, panel);

  app.replaceChildren(el('div', { class: 'shell' },
    el('nav', { class: 'nav', 'aria-label': 'Main' }, chat.agentSwitch, newChatLink, chat.sidebar, el('div', { class: 'nav-foot' }, agentsLink, settingsLink, conn)),
    el('main', { class: 'main' }, banner, chat.root, agents, settings)));
  // The toggle lives on <body>, not in #app: boot() replaces #app with the "ERP server stopped" screen, and a panel collapsed to
  // its 40 px rail must still have a button that expands it. It appears with the first shell and stays.
  if (OS && !document.querySelector('.panel-toggle')) document.body.append(panelToggle());
  document.body.classList.toggle('os-panel', OS);
  // panel mode opens on the ERP assistant; Agents and Settings stay one click away
  if (erpAgent) void chat.refreshAgents().then(() => chat.selectAgent(erpAgent));

  let view: 'chat' | 'agents' | 'settings' = 'chat';
  const current = (page: boolean) => (page ? 'page' : 'false');
  nav = () => {
    newChatLink.setAttribute('aria-current', current(view === 'chat' && chat.isEmpty()));
    agentsLink.setAttribute('aria-current', current(view === 'agents'));
    settingsLink.setAttribute('aria-current', current(view === 'settings'));
  };

  function route(): void {
    const asked = /^#\/settings\/(\w+)/.exec(location.hash)?.[1];
    const section = SECTIONS.find((s) => s.id === (asked && ALIASES[asked] || asked));
    const agentRoute = /^#\/agents(?:\/([^/?]+))?$/.exec(location.hash);
    const agentId = agentRoute?.[1];
    let badId = false; // a hash that is not valid percent-encoding opens the roster instead of throwing
    if (agentId && agentId !== 'new') { try { decodeURIComponent(agentId); } catch { badId = true; } }
    if (badId) { location.hash = '#/agents'; return; }
    const isAgents = agentRoute !== null;
    view = section ? 'settings' : isAgents ? 'agents' : 'chat';
    chat.root.hidden = view !== 'chat';
    agents.hidden = !isAgents;
    settings.hidden = !section;
    if (chat.root.hidden) chat.leave();
    nav();
    if (agentRoute) {
      const changed = (id?: string) => { void chat.refreshAgents().then(() => { if (id) return chat.selectAgent(id); }); };
      // every agents route gets its own host: a roster load that finishes after the route changed must not draw over the form
      const host = freshHost(agents);
      if (agentId === undefined) mountAgents(host, api, changed);
      else mountAgentForm(host, api, agentId === 'new' ? undefined : decodeURIComponent(agentId), changed);
    }
    if (isAgents) agents.scrollTop = 0;
    if (section) {
      for (const t of tabs) { const on = t.id === `tab-${section.id}`; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; }
      const host = el('div', { id: 'settings-panel', role: 'tabpanel', 'aria-labelledby': `tab-${section.id}` });
      panel.replaceWith(host); panel = host; settings.scrollTop = 0;
      section.mount(host, api, new URLSearchParams(location.hash.split('?')[1] ?? ''), () => { void chat.refreshAgents(); });
    }
    else if (!isAgents) void chat.refreshAgents();
  }
  window.onhashchange = route;
  document.onkeydown = (ev) => {
    if (ev.metaKey && ev.key === 'n') { ev.preventDefault(); location.hash = '#/chat'; chat.newChat(); }
    else if (ev.metaKey && ev.key === ',') { ev.preventDefault(); location.hash = '#/settings/model'; }
    else if (ev.metaKey && ev.key === 'f' && !chat.root.hidden) { ev.preventDefault(); chat.focusSearch(); }
    else chat.onKey(ev);
  };
  route();

  events = new AbortController();
  let failures = 0;
  let wasDown = false;
  void streamEvents((signal) => api.events(signal), {
    onData(data) {
      try {
        const e = JSON.parse(data) as ApiEvent;
        if (e && typeof e.type === 'string') chat.onEvent(e);
      } catch { /* ignore a malformed frame */ }
    },
    onState(connected) {
      conn.textContent = connected ? 'Connected' : 'Reconnecting…';
      conn.classList.toggle('down', !connected);
      chat.setOnline(connected);
      if (connected) {
        chat.onStreamOpen();
        banner.hidden = true;
        failures = 0;
        if (wasDown) chat.refresh();
        wasDown = false;
      } else {
        wasDown = true;
        if (++failures >= 3) banner.hidden = false;
      }
    },
  }, events.signal);
}

void boot();
