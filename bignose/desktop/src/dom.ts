// Tiny DOM helpers. Everything goes in as text nodes or properties, never as HTML.
import { parseBlocks, parseInline } from './format.ts';
import type { Agent } from './types.ts';

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;
const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected']);

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') node.className = String(v);
    else if (PROPS.has(k)) Reflect.set(node, k, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  add(node, kids);
  return node;
}

export function add(parent: Node, kids: Child[]): void {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    parent.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
  }
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = el('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  host.appendChild(t);
  window.setTimeout(() => t.remove(), kind === 'error' ? 8000 : 3500);
}

/** Runs `fn` with `btn` disabled and shows a failure as a toast. */
export async function guarded(fn: () => Promise<unknown>, btn?: { disabled: boolean }): Promise<boolean> {
  if (btn) btn.disabled = true;
  try { await fn(); return true; }
  catch (e) { toast(errMsg(e), 'error'); return false; }
  finally { if (btn) btn.disabled = false; }
}

export function btn(label: string, onClick: (b: HTMLButtonElement) => void, kind = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', class: `btn ${kind}`.trim() }, label);
  b.addEventListener('click', () => onClick(b));
  return b;
}

/** Label wrapping its control, plus an optional hint below. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return el('div', { class: 'field' }, el('label', {}, el('span', { class: 'field-label' }, label), control), hint && el('div', { class: 'hint' }, hint));
}

export function check(label: string, checked: boolean, onChange?: (on: boolean) => void): { root: HTMLLabelElement; input: HTMLInputElement } {
  const input = el('input', { type: 'checkbox', checked });
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  return { root: el('label', { class: 'check' }, input, el('span', {}, label)), input };
}

export function select(options: [value: string, label: string][], value: string): HTMLSelectElement {
  const s = el('select', {}, ...options.map(([v, l]) => el('option', { value: v, selected: v === value }, l)));
  s.value = value;
  return s;
}

export function badge(text: string, tone = ''): HTMLElement {
  return el('span', { class: `badge ${tone}`.trim() }, text);
}

/** API times are epoch milliseconds (or seconds from older rows) or a date string. */
function toDate(t: number | string | null | undefined): Date | null {
  if (t === null || t === undefined || t === '') return null;
  const d = new Date(typeof t === 'number' && t < 1e11 ? t * 1000 : t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** English, 24 h, so dates never mix Thai month names into the English UI: "08:00" today, "15 Oct 08:00" before. */
export function formatTime(t: number | string | null | undefined): string {
  const d = toDate(t);
  if (!d) return '';
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
}

/** The sidebar group a chat belongs to, by the day it was last updated. */
export function sessionGroup(t: number | string | null | undefined): 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older' {
  const d = toDate(t);
  if (!d) return 'Older';
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const age = Math.round((day(new Date()) - day(d)) / 86_400_000);
  return age <= 0 ? 'Today' : age === 1 ? 'Yesterday' : age <= 7 ? 'Previous 7 days' : 'Older';
}

/** Tags (or untags) an element's own language from its text. */
export function setLang(node: Element, text: string): void {
  const lang = th(text);
  if (lang) node.setAttribute('lang', lang); else node.removeAttribute('lang');
}

/** `lang` for text that contains Thai, so the right font and line height apply; `el()` skips undefined. */
export const th = (text: string): 'th' | undefined => (/[\u0E00-\u0E7F]/.test(text) ? 'th' : undefined);

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgUse(href: string, cls = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  if (cls) svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', href);
  svg.appendChild(use);
  return svg;
}

/** A 16px sprite icon from index.html (`#i-<name>`). */
export const icon = (name: string, extra = ''): SVGSVGElement => svgUse(`#i-${name}`, `i ${extra}`.trim());

/** The app icon, for the splash and the empty chat. */
export const appIcon = (): HTMLImageElement => el('img', { src: 'icon-128.png', alt: '' });

const BOT = '\u{1F916}'; // the default icon the API gives new agents

/** An agent's emoji on a neutral circle; agents without their own emoji get the headphone bot. */
export function avatar(a: Pick<Agent, 'icon'>, size: '' | 'sm' = ''): HTMLElement {
  const glyph = a.icon.trim();
  const cls = `avatar ${size}`.trim();
  if (glyph.startsWith('i:')) return el('span', { class: `${cls} sprite-icon`, 'aria-hidden': 'true' }, icon(glyph.slice(2))); // built-in agents use a sprite icon, not an emoji
  if (glyph && glyph !== BOT) return el('span', { class: cls, 'aria-hidden': 'true' }, glyph);
  const bot = el('span', { class: `${cls} bot`, 'aria-hidden': 'true' });
  bot.appendChild(svgUse('#bot'));
  return bot;
}

/** A modal question. Cancel has focus and Esc cancels; resolves true only for the action button. */
export function confirmDialog(o: { title: string; body?: string; action?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const cancel = el('button', { type: 'submit', value: 'cancel', class: 'btn', autofocus: true }, 'Cancel');
    const ok = el('button', { type: 'submit', value: 'ok', class: 'btn danger' }, o.action ?? 'Delete');
    const dialog = el('dialog', { class: 'confirm', 'aria-labelledby': 'confirm-title' },
      el('h2', { id: 'confirm-title', lang: th(o.title) }, o.title), o.body && el('p', { lang: th(o.body) }, o.body),
      el('form', { method: 'dialog', class: 'dialog-actions' }, cancel, ok));
    dialog.addEventListener('close', () => { resolve(dialog.returnValue === 'ok'); dialog.remove(); });
    document.body.appendChild(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

export function copyText(text: string): void {
  if (typeof navigator === 'undefined' || !navigator.clipboard) { toast('Copy is not available here', 'error'); return; }
  navigator.clipboard.writeText(text).then(() => toast('Copied'), (e: unknown) => toast(errMsg(e), 'error'));
}

function copyButton(text: string): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'btn quiet small', 'aria-label': 'Copy code' }, icon('copy'), 'Copy');
  b.addEventListener('click', () => copyText(text));
  return b;
}

const inline = (text: string): Child[] => parseInline(text).map((i) => i.kind === 'text' ? i.text : el(i.kind === 'strong' ? 'strong' : 'code', {}, i.text));

/** Renders model or tool text safely: headings, paragraphs, lists, bold, code and fenced code, all from text nodes. */
export function renderText(into: HTMLElement, text: string): void {
  into.replaceChildren(...parseBlocks(text).map((b) => {
    switch (b.kind) {
      case 'p': return el('p', {}, ...inline(b.text));
      case 'h': return el(b.level === 2 ? 'h2' : 'h3', {}, ...inline(b.text));
      case 'ul': case 'ol': return el(b.kind, {}, ...b.items.map((it) => el('li', {}, ...inline(it))));
      case 'code': return el('pre', { class: 'code' }, el('span', { class: 'code-head' }, el('span', { class: 'code-lang' }, b.lang), copyButton(b.text)), el('code', {}, b.text));
    }
  }));
  setLang(into, text);
}

/** A fresh empty element inside `container`, so a late load from a page the user already left writes into a detached element. */
export function freshHost(container: HTMLElement): HTMLElement {
  const host = el('div');
  container.replaceChildren(host);
  return host;
}

/** Loads data into a pane with a loading state and a retry on failure. */
export async function load<T>(pane: HTMLElement, fetcher: () => Promise<T>, render: (data: T) => void): Promise<void> {
  pane.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
  try {
    const data = await fetcher();
    pane.replaceChildren();
    render(data);
  } catch (e) {
    pane.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, el('p', {}, errMsg(e)), btn('Retry', () => void load(pane, fetcher, render))));
  }
}
