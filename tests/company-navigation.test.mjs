import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../core.js';

const source = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8')
  .replace(/^import[^\n]+\n/, '');
const expected = 'https://www.zhipin.com/gongsi/expected.html';
const other = 'https://www.zhipin.com/gongsi/different.html';
function fixture({ tabs: initial = {}, get, sendMessage } = {}) {
  const tabs = new Map(Object.entries(initial).map(([id, tab]) => [Number(id), { id: Number(id), ...tab }]));
  const stored = {}, messages = [], removed = [], navigated = []; let reads = 0, creates = 0;
  const chrome = {
    storage: { local: { get: async key => key === null ? structuredClone(stored) : { [key]: structuredClone(stored[key]) }, set: async data => Object.assign(stored, structuredClone(data)) } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, onClicked: { addListener() {} } },
    alarms: { create: async () => {}, clear: async () => {}, get: async () => null, onAlarm: { addListener() {} } },
    runtime: { getURL: path => 'chrome-extension://fixture/' + path, onMessage: { addListener() {} }, onStartup: { addListener() {} } },
    tabs: {
      get: async id => { reads++; if (get) return get(id, reads, tabs); if (!tabs.has(id)) throw Error('closed'); return structuredClone(tabs.get(id)); },
      create: async data => { creates++; const tab = { id: creates + 10, ...data }; tabs.set(tab.id, tab); return tab; },
      remove: async id => { removed.push(id); tabs.delete(id); },
      update: async (id, data) => { navigated.push({ id, ...data }); return Object.assign(tabs.get(id), data); },
      reload: async id => { navigated.push({ id, reload: true }); }, query: async () => [],
      sendMessage: async (id, message) => { messages.push(message); return sendMessage ? sendMessage(id, message, tabs) : { ok: true, data: { name: '测试公司', sourceUrl: expected, ready: true } }; }
    }
  };
  const context = vm.createContext({ ...core, chrome, URL, Date, crypto, structuredClone, console,
    // Short loading waits progress deterministically; message timeouts stay inert
    // until their immediately resolving page replies clear them.
    setTimeout: (fn, delay) => { if (delay <= 500) queueMicrotask(fn); return {}; }, clearTimeout() {} });
  vm.runInContext(source + '\nglobalThis.check = {send,listTab,closeOwned,recoverConnection};', context);
  return { api: context.check, tabs, messages, removed, navigated, stored, get creates() { return creates; }, get reads() { return reads; } };
}

for (const committed of ['', 'about:blank']) {
  test(`a new owned company tab can briefly lack pendingUrl without being read (${committed || 'empty URL'})`, async () => {
    const h = fixture({ get: async (id, reads) => reads < 3
      ? { id, status: 'loading', url: committed }
      : reads < 5 ? { id, status: 'loading', url: committed, pendingUrl: expected }
      : { id, status: 'complete', url: expected } });
    const info = await h.api.send(1, 'company', { expectedUrl: expected });
    assert.equal(info.name, '测试公司');
    assert.equal(h.messages.filter(m => m.action === 'company').length, 1);
    assert.ok(h.reads >= 5);
  });
}

test('an unknown blank company tab waits finitely but cannot be read, closed or automatically navigated', async () => {
  const h = fixture({ tabs: { 1: { status: 'loading', url: '' } } });
  await assert.rejects(h.api.send(1, 'company', { expectedUrl: expected }), /页面连接失败/);
  assert.equal(h.messages.length, 0); assert.ok(h.reads < 100);
  const task = Object.assign(core.fresh({ keyword: '剪辑', cities: ['北京'] }), {
    status: 'running', detailTab: { id: 1, url: expected }
  });
  await assert.rejects(h.api.closeOwned(task), /地址发生变化|仍在加载/);
  assert.equal(await h.api.recoverConnection(task, { action: 'company' }), false);
  assert.equal(h.navigated.length, 0); assert.equal(h.removed.length, 0);
  assert.ok(task.detailTab);
  // Explicit ownership evidence permits the existing bounded recovery path.
  h.tabs.get(1).pendingUrl = expected;
  assert.equal(await h.api.recoverConnection(task, { action: 'company' }), true);
  assert.equal(h.navigated.length, 1); assert.equal(h.navigated[0].url, expected);
});

for (const committed of ['', 'about:blank']) {
  test(`a new owned company tab waits for its expected pending URL to commit (${committed || 'empty URL'})`, async () => {
    const h = fixture({ get: async (id, reads) => reads < 4
      ? { id, status: 'loading', url: committed, pendingUrl: expected }
      : { id, status: 'complete', url: expected } });
    const info = await h.api.send(1, 'company', { expectedUrl: expected });
    assert.equal(info.name, '测试公司');
    assert.equal(h.messages.filter(m => m.action === 'company').length, 1);
    assert.ok(h.reads >= 4);
  });
}

test('a different pending company destination cannot be read as the still-committed company', async () => {
  const h = fixture({ tabs: { 1: { status: 'loading', url: expected, pendingUrl: other } } });
  await assert.rejects(h.api.send(1, 'company', { expectedUrl: expected }), /地址发生变化/);
  assert.equal(h.messages.length, 0);
});

test('a destination changed during a company reply is rejected before accepting its data', async () => {
  const h = fixture({ tabs: { 1: { status: 'complete', url: expected } }, sendMessage: async (id, message, tabs) => {
    tabs.get(id).pendingUrl = other;
    return { ok: true, data: { name: '错误公司', sourceUrl: expected } };
  } });
  await assert.rejects(h.api.send(1, 'company', { expectedUrl: expected }), /地址发生变化/);
});

test('closing an owned company page preserves a pending unrelated navigation', async () => {
  const h = fixture({ tabs: { 1: { status: 'loading', url: expected, pendingUrl: other } } });
  const task = { detailTab: { id: 1, url: expected } };
  await assert.rejects(h.api.closeOwned(task), /地址发生变化/);
  assert.equal(h.removed.length, 0);
  assert.ok(task.detailTab);
});

test('a pending expected company page is bounded and never read before committing', async () => {
  const h = fixture({ tabs: { 1: { status: 'loading', url: '', pendingUrl: expected } } });
  await assert.rejects(h.api.send(1, 'company', { expectedUrl: expected }), /页面连接失败/);
  assert.equal(h.messages.length, 0);
  assert.ok(h.reads < 100);
});

test('login, unrelated company and external destinations still stop without reading or closing', async () => {
  for (const url of ['https://www.zhipin.com/web/user/?ka=header-login', other, 'https://example.com/']) {
    const h = fixture({ tabs: { 1: { status: 'complete', url } } });
    await assert.rejects(h.api.send(1, 'company', { expectedUrl: expected }), /地址发生变化/);
    const task = { detailTab: { id: 1, url: expected } };
    await assert.rejects(h.api.closeOwned(task), /地址发生变化/);
    assert.equal(h.messages.length, 0); assert.equal(h.removed.length, 0);
  }
});

test('the same company query or hash is accepted while a mismatching source reply is rejected', async () => {
  const h = fixture({ tabs: { 1: { status: 'complete', url: expected + '?ka=search#info' } }, sendMessage: async () => ({ ok: true, data: { name: '错误公司', sourceUrl: other } }) });
  await assert.rejects(h.api.send(1, 'company', { expectedUrl: expected }), /来源链接不一致/);
});

test('a list tab with its expected URL still pending is reused instead of duplicated', async () => {
  const h = fixture({ tabs: { 1: { status: 'loading', url: '', pendingUrl: 'https://www.zhipin.com/web/geek/jobs?query=test' } } });
  const task = Object.assign(core.fresh({ keyword: '剪辑', cities: ['北京'] }), { tabId: 1 });
  const tab = await h.api.listTab(task);
  assert.equal(tab.id, 1);
  assert.equal(h.creates, 0);
});
