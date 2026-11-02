// The helpers behind the simple UI: Thai tagging, avatars, icons, times, markdown text, and the tool sentences.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avatar, formatTime, icon, renderText, sessionGroup, th } from '../src/dom.ts';
import { toolLine } from '../src/chat.ts';
import { installDom } from './dom-fixture.ts';
import type { TestNode } from './dom-fixture.ts';

test('th tags text that has Thai in it and nothing else', () => {
  assert.equal(th('สวัสดี'), 'th');
  assert.equal(th('Open ผู้ช่วย now'), 'th');
  assert.equal(th('Hello'), undefined);
  assert.equal(th(''), undefined);
});

test('an agent with its own emoji gets it on a neutral circle; the default and a blank icon get the bot', (t) => {
  t.after(installDom());
  const emoji = avatar({ icon: '🔎' }, 'sm') as unknown as TestNode;
  assert.equal(emoji.className, 'avatar sm'); assert.equal(emoji.textContent, '🔎'); assert.equal(emoji.attrs['aria-hidden'], 'true');
  const built = avatar({ icon: 'i:receipt' }) as unknown as TestNode;
  assert.equal(built.className, 'avatar sprite-icon'); assert.equal(built.textContent, '');
  for (const none of ['🤖', '', '  ']) {
    const bot = avatar({ icon: none }) as unknown as TestNode;
    assert.equal(bot.className, 'avatar bot');
    assert.equal(bot.querySelector('svg')!.querySelector('use')!.attrs.href, '#bot');
    assert.equal(bot.textContent, '');
  }
});

test('icon is a hidden sprite reference, never markup', (t) => {
  t.after(installDom());
  const i = icon('chev-r', 'chev') as unknown as TestNode;
  assert.equal(i.attrs.class, 'i chev'); assert.equal(i.attrs['aria-hidden'], 'true');
  assert.equal(i.querySelector('use')!.attrs.href, '#i-chev-r');
});

test('times are English and 24 hour; chats group by the day they were updated', () => {
  const at = (days: number, h = 8, m = 5) => { const d = new Date(); d.setDate(d.getDate() - days); d.setHours(h, m, 0, 0); return d.getTime(); };
  assert.equal(formatTime(at(0)), '08:05');
  assert.match(formatTime(at(40, 18, 30)), /^\d{1,2} [A-Z][a-z]{2,4} 18:30$/);
  assert.equal(formatTime(undefined), ''); assert.equal(formatTime('not a date'), '');
  assert.deepEqual([0, 1, 2, 7, 8, 90].map((d) => sessionGroup(at(d))), ['Today', 'Yesterday', 'Previous 7 days', 'Previous 7 days', 'Older', 'Older']);
  assert.equal(sessionGroup(null), 'Older');
  assert.equal(sessionGroup(Date.now() + 3_600_000), 'Today');
});

test('renderText builds headings, lists, bold, code and a code block with Copy, from text nodes only, and tags Thai', (t) => {
  t.after(installDom());
  const body = document.createElement('div') as unknown as TestNode;
  renderText(body as unknown as HTMLElement, '## หัวข้อ\nเป็น **TypeScript** และ `src/`\n- one\n- two\n```bash\nnpm run build\n```');
  assert.deepEqual(body.children.map((c) => c.tag), ['h2', 'p', 'ul', 'pre']);
  assert.equal(body.attrs.lang, 'th');
  assert.equal(body.querySelector('strong')!.textContent, 'TypeScript');
  assert.equal(body.querySelector('code')!.textContent, 'src/');
  assert.deepEqual(body.querySelectorAll('li').map((l) => l.textContent), ['one', 'two']);
  const pre = body.querySelector('pre')!;
  assert.equal(pre.className, 'code');
  assert.equal(pre.querySelector('.code-lang')!.textContent, 'bash');
  const copy = pre.querySelector('.code-head')!.querySelector('button')!;
  assert.equal(copy.textContent, 'Copy'); assert.equal(copy.attrs['aria-label'], 'Copy code');
  assert.equal(pre.children[1]!.textContent, 'npm run build');
  renderText(body as unknown as HTMLElement, 'plain <b>text</b>');
  assert.equal(body.attrs.lang, undefined, 'the language tag goes away with the Thai');
  assert.equal(body.textContent, 'plain <b>text</b>');
});

const text = (parts: (Node | string)[]) => parts.map((p) => (typeof p === 'string' ? p : p.textContent)).join('');

test('every tool has a running, done and failed sentence; paths show their last segment', (t) => {
  t.after(installDom());
  const line = (name: string, input: Record<string, unknown>, out = '') => { const l = toolLine(name, input, '/Users/me/work'); return [text(l.running), text(l.done(out)), text(l.failed), l.icon]; };
  assert.deepEqual(line('list_files', { path: '/Users/me/shop-site/' }, 'a\nb\n\nc'), ['Looking in shop-site…', 'Looked at 3 items in shop-site', "Couldn't look in shop-site", 'folder']);
  assert.equal(text(toolLine('list_files', {}, '/Users/me/work').running), 'Looking in work…', 'no path means the work folder');
  assert.equal(line('list_files', { path: 'x' }, 'only')[1], 'Looked at 1 item in x');
  assert.deepEqual(line('read_file', { path: 'src/a/package.json' }), ['Reading package.json…', 'Read package.json', "Couldn't read package.json", 'file']);
  assert.deepEqual(line('search_files', { pattern: 'TODO' }, 'a:1: x\nb:2: y'), ['Searching for “TODO”…', 'Found 2 matches for “TODO”', "Couldn't search for “TODO”", 'search']);
  assert.deepEqual(line('write_file', { path: '/a/notes.md' }), ['Writing notes.md…', 'Wrote notes.md', "Couldn't write notes.md", 'pencil']);
  assert.deepEqual(line('edit_file', { path: '/a/notes.md' }), ['Editing notes.md…', 'Edited notes.md', "Couldn't edit notes.md", 'pencil']);
  assert.deepEqual(line('shell', { command: 'npm run build' }), ['Running npm run build…', 'Ran npm run build', "Couldn't run npm run build", 'term']);
  assert.deepEqual(line('web_fetch', { url: 'https://example.com/a/b?q=1' }), ['Opening example.com…', 'Opened example.com', "Couldn't open example.com", 'globe']);
  assert.deepEqual(line('delegate', { task: 'x' }), ['Asking a helper…', 'A helper answered', "The helper didn't answer", 'agents']);
  assert.deepEqual(line('memory_write', {}), ['Saving a note…', 'Saved a note', "Couldn't save a note", 'book']);
  assert.equal(line('memory_read', {})[1], 'Read notes');
  assert.deepEqual(line('skill_load', { name: 'pdf' }).slice(0, 2), ['Loading pdf…', 'Used skill pdf']);
});

test('an unknown tool keeps its raw id so nothing is hidden, and shows its first text argument', (t) => {
  t.after(installDom());
  const l = toolLine('mcp__rea__open_binary', { depth: 3, path: '/tmp/target' });
  assert.equal(text(l.running), 'mcp__rea__open_binary'); assert.equal(text(l.done('x')), 'mcp__rea__open_binary'); assert.equal(text(l.failed), 'mcp__rea__open_binary');
  assert.equal(l.icon, 'wrench'); assert.equal(l.arg, '/tmp/target');
  assert.equal(toolLine('mcp__x__y', { n: 1 }).arg, undefined);
});
