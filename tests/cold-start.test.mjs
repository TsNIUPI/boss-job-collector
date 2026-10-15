import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../core.js';

// A suspended MV3 worker loses its globals. A one-shot alarm may already have
// been removed by Chrome when that event starts a new worker. Unlike the older
// harness, these checks never force a scheduled nextRunAt into the past.
const background = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8')
  .replace(/^import[^\n]+\n/, '');
const settle = async () => {
  for (let n = 0; n < 50; n++) await new Promise(resolve => setImmediate(resolve));
};

function environment({ status = 'running', dueIn = -1, existingAlarm = false, legacyPacing, restUntil, config = {}, cardCount = 1, distinctCompanies = false } = {}) {
  let now = Date.now(), nextTab = 2, nextTimer = 1;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const task = core.fresh({ keyword: '剪辑', cities: ['北京'], target: 40, interval: 60, varied: false, ...config });
  core.beginRound(task);
  Object.assign(task, { status, phase: 'scan', tabId: 1, nextRunAt: now + dueIn });
  const stored = { task }, alarms = new Map(), timers = new Map(), requests = [];
  if (legacyPacing) stored.pacingSession = { startedAt: now - 24 * 60 * 60 * 1000, companies: 3, restUntil: 0 };
  if (restUntil) stored.pacingSession = { startedAt: now - 30 * 60 * 1000, companies: 3, restUntil: now + restUntil };
  if (existingAlarm) alarms.set('boss-collector-tick', { name: 'boss-collector-tick', scheduledTime: task.nextRunAt });
  const tabs = new Map([[1, { id: 1, status: 'complete', url: 'https://www.zhipin.com/web/geek/jobs?query=' + encodeURIComponent('剪辑') }]]);
  const sample = { title: '剪辑', url: 'https://www.zhipin.com/job_detail/example.html', company_url: 'https://www.zhipin.com/gongsi/example.html', location: '北京·朝阳' };
  const listCards = cardCount === 1 ? [sample] : Array.from({ length: cardCount }, (_, index) => ({
    ...sample, title: '剪辑' + index, url: `https://www.zhipin.com/job_detail/example${index}.html`,
    company_url: distinctCompanies ? `https://www.zhipin.com/gongsi/company${index}.html` : sample.company_url
  }));
  let events;
  const startWorker = () => {
    // Worker destruction discards every old setTimeout callback; only durable
    // storage, browser tabs and Chrome alarms survive into the next worker.
    timers.clear();
    events = {};
    const chrome = {
      storage: { local: {
        get: async key => key === null ? structuredClone(stored) : { [key]: structuredClone(stored[key]) },
        set: async value => Object.assign(stored, structuredClone(value))
      } },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, onClicked: { addListener: fn => { events.click = fn; } } },
      runtime: {
        getURL: path => 'chrome-extension://fixture/' + path,
        onMessage: { addListener: fn => { events.message = fn; } },
        onStartup: { addListener: fn => { events.startup = fn; } }
      },
      alarms: {
        get: async name => alarms.get(name),
        create: async (name, options) => alarms.set(name, { name, scheduledTime: options.when }),
        clear: async name => alarms.delete(name),
        onAlarm: { addListener: fn => { events.alarm = fn; } }
      },
      tabs: {
        get: async id => { if (!tabs.has(id)) throw Error('closed'); return tabs.get(id); },
        create: async value => { const tab = { id: nextTab++, status: 'complete', ...value }; tabs.set(tab.id, tab); return tab; },
        update: async (id, value) => Object.assign(tabs.get(id), value),
        remove: async id => tabs.delete(id), query: async () => [], reload: async () => {},
        sendMessage: async (id, message) => {
          requests.push(message.action);
          return { ok: true, data: message.action === 'company'
            ? { name: '示例公司' + id, sourceUrl: message.expectedUrl || sample.company_url }
            : message.action === 'city' ? { city: '北京' }
            : { cards: listCards, end: '', changed: false } };
        }
      }
    };
    // Timer promises are deterministic and never keep the Node process alive.
    // Page replies above resolve immediately; pageMessage clears those timers.
    const context = vm.createContext({
      ...core, chrome, structuredClone, URL, crypto, Date: Clock, console,
      setTimeout: (fn, delay) => { const id = nextTimer++; timers.set(id, { fn, delay }); return id; },
      clearTimeout: id => timers.delete(id)
    });
    vm.runInContext(background, context, { filename: 'background.js' });
    return events;
  };
  const command = message => new Promise(resolve => events.message(
    { channel: 'boss-dashboard', ...message },
    { url: 'chrome-extension://fixture/dashboard.html' }, resolve));
  const fireAlarm = async () => {
    alarms.delete('boss-collector-tick');
    await events.alarm({ name: 'boss-collector-tick' });
    await settle();
  };
  return { stored, alarms, requests, startWorker, command, fireAlarm,
    get now() { return now; }, advance: ms => { now += ms; } };
}

test('a consumed one-shot alarm waking a cold worker executes the due checkpoint', async () => {
  const h = environment();
  h.startWorker();
  // Deliver before bootstrap settles: this is the actual cold event ordering.
  await h.fireAlarm();
  assert.equal(core.savedCount(h.stored.task), 1);
  assert.equal(h.requests.filter(action => action === 'company').length, 1);
  assert.equal(h.stored.task.status, 'running');
});

test('cold recovery rearms a future deadline without restarting its wait', async () => {
  const h = environment({ dueIn: 20_000 });
  const due = h.stored.task.nextRunAt;
  h.startWorker(); await settle();
  assert.equal(h.stored.task.nextRunAt, due);
  assert.equal(h.requests.length, 0);
  assert.ok(h.alarms.has('boss-collector-tick'));
  h.advance(30_000); await h.fireAlarm();
  assert.equal(core.savedCount(h.stored.task), 1);
});

test('a warm alarm and its stale duplicate cannot execute two collection steps', async () => {
  const h = environment({ dueIn: 60_000, existingAlarm: true });
  h.startWorker(); await settle();
  h.advance(60_000); await h.fireAlarm();
  assert.equal(core.savedCount(h.stored.task), 1);
  const requests = h.requests.length, due = h.stored.task.nextRunAt;
  await h.fireAlarm();
  assert.equal(h.requests.length, requests);
  assert.equal(h.stored.task.nextRunAt, due);
});

test('an overdue running checkpoint recovers without waiting for another fresh interval', async () => {
  const h = environment({ dueIn: -15 * 60_000 });
  h.startWorker(); await settle();
  assert.equal(core.savedCount(h.stored.task), 1);
  assert.equal(h.requests.filter(action => action === 'company').length, 1);
});

test('yesterday legacy wall-clock pacing cannot impose a fresh one-hour rest', async () => {
  const h = environment({ status: 'paused', legacyPacing: true });
  h.startWorker(); await settle();
  const response = await h.command({ action: 'resume' });
  assert.equal(response.ok, true);
  assert.equal(h.stored.task.status, 'running');
  assert.equal(h.stored.pacingSession.restUntil, 0);
});

test('an explicit unexpired rest stays enforced during session migration', async () => {
  const h = environment({ status: 'paused', restUntil: 30 * 60_000 });
  const until = h.stored.pacingSession.restUntil;
  h.startWorker(); await settle();
  const response = await h.command({ action: 'resume' });
  assert.equal(response.ok, false);
  assert.match(response.error, /休息/);
  assert.equal(h.stored.pacingSession.restUntil, until);
  assert.equal(h.requests.length, 0);
});

test('manual pauses exclude idle hours while retaining active time toward the rest budget', async () => {
  const h = environment({ status: 'paused' });
  h.startWorker(); await settle();
  assert.equal((await h.command({ action: 'resume' })).ok, true);
  h.advance(2 * 60_000);
  assert.equal((await h.command({ action: 'pause' })).ok, true);
  h.advance(12 * 60 * 60_000);
  assert.equal((await h.command({ action: 'resume' })).ok, true);
  h.advance(27 * 60_000 + 59_000); await h.fireAlarm();
  assert.equal(h.stored.task.status, 'running');
  const before = h.requests.length;
  h.advance(60_000); await h.fireAlarm();
  assert.equal(h.stored.task.status, 'paused');
  assert.match(h.stored.task.reason, /30分钟|休息/);
  assert.equal(h.requests.length, before);
  assert.ok(h.stored.pacingSession.restUntil > h.now);
});

test('browser startup excludes closed hours before an overdue cold checkpoint can enforce rest', async () => {
  const h = environment();
  const yesterday = h.now - 12 * 60 * 60_000;
  h.stored.task.updatedAt = yesterday + 2 * 60_000;
  h.stored.task.nextRunAt = yesterday + 3 * 60_000;
  h.stored.pacingSession = { version: 2, elapsedMs: 0, runningSince: yesterday, startedAt: yesterday, companies: 3, restUntil: 0 };
  const events = h.startWorker();
  // Chrome dispatches onStartup to the newly evaluated worker. Module bootstrap
  // and this event must share one restart decision, before checking active time.
  await events.startup(); await settle();
  assert.equal(h.stored.task.status, 'running');
  assert.equal(h.stored.pacingSession.restUntil, 0);
});

test('three warm saves continue through 27 cold alarm wakeups and stop at exactly 30 new jobs', async t => {
  const h = environment({ dueIn: 30_000, existingAlarm: true,
    config: { target: 30, interval: 10, varied: false }, cardCount: 30, distinctCompanies: true });
  const began = h.now;
  let steps = 0;
  h.startWorker(); await settle();
  const wake = async cold => {
    const alarm = h.alarms.get('boss-collector-tick');
    assert.ok(alarm, 'running work must retain its durable alarm');
    assert.ok(alarm.scheduledTime >= h.now);
    // Advance the clock to the browser alarm, never mutate nextRunAt itself.
    h.advance(alarm.scheduledTime - h.now);
    if (cold) h.startWorker();
    // fireAlarm consumes the one-shot before cold bootstrap can see it.
    await h.fireAlarm();
    steps++;
    assert.equal(core.roundCount(h.stored.task), steps, `collection must advance at wakeup ${steps}`);
    assert.equal(h.requests.filter(action => action === 'company').length, steps);
  };
  for (let count = 0; count < 3; count++) await wake(false);
  assert.equal(core.savedCount(h.stored.task), 3);
  assert.equal(h.stored.task.status, 'running');
  for (let count = 0; count < 27; count++) await wake(true);
  assert.equal(steps, 30);
  assert.equal(core.roundCount(h.stored.task), 30);
  assert.equal(core.savedCount(h.stored.task), 30);
  assert.equal(Object.keys(h.stored.task.companies).length, 30);
  assert.equal(h.stored.task.status, 'paused');
  assert.equal(h.stored.task.stopReason, 'target');
  assert.equal(h.stored.task.nextRunAt, null);
  assert.equal(h.alarms.has('boss-collector-tick'), false);
  assert.ok(h.now - began < 30 * 60_000);
  t.diagnostic(`30 wakeups: 3 warm + 27 cold; saved 30/30 from 30 companies; virtual elapsed ${(h.now - began) / 1000}s; stopped at target.`);
});
