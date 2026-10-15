import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

// Optional browser check, like content-check.mjs. Install Playwright normally,
// or point BOSS_PLAYWRIGHT_MODULE at an existing Playwright entry module.
const moduleName = process.env.BOSS_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.BOSS_PLAYWRIGHT_MODULE).href : 'playwright';
const { chromium } = await import(moduleName);
const browser = await chromium.launch({ channel: process.env.BOSS_TEST_BROWSER_CHANNEL || 'chrome', headless: true });
const cards = Array.from({ length: 3 }, (_, n) => `<div class="job-card-box"><a class="job-name" href="/job_detail/j${n}.html">剪辑${n}</a><p>北京·朝阳</p><a href="/gongsi/c${n}.html">公司${n}</a></div>`).join('');
const fixtures = [
  {
    name: 'three jobs plus unrelated sidebar end is not a finished job list', count: 3, end: '',
    html: `<main><div class="job-list-box">${cards}</div><aside>推荐文章<span>没有更多了</span></aside></main>`
  },
  {
    name: 'an explicit end inside the actual list is retained', count: 3, end: '没有更多了',
    html: `<main><div class="job-list-box">${cards}<p>没有更多了</p></div></main>`
  },
  {
    name: 'a unique visible empty job list can confirm its explicit end', count: 0, end: '没有更多岗位',
    html: '<main><div class="job-list-box"><p>没有更多岗位</p></div></main>'
  },
  {
    name: 'the traditional simple footer next to the list remains supported', count: 3, end: '没有更多了',
    html: `<div class="host"><div class="jobs">${cards}</div><p>没有更多了</p></div>`
  },
  {
    name: 'a large sibling section cannot supply the list end', count: 3, end: '',
    html: `<main><div class="job-list-box">${cards}</div><section><h2>推荐资讯</h2><div><span>没有更多了</span></div></section></main>`
  },
  {
    name: 'multiple empty candidate lists are not guessed', count: 0, end: '',
    html: '<main><div class="job-list-box"></div><div class="job-list-container"><p>没有更多了</p></div></main>'
  },
  {
    name: 'an anchor identifies its own list even when another list has an end', count: 3, end: '',
    html: `<main><div class="job-list-box">${cards}</div><section><div class="job-list-container"><p>没有更多了</p></div></section></main>`
  }
];
try {
  const reader = await fs.readFile(new URL('../page-reader.js', import.meta.url), 'utf8');
  const content = await fs.readFile(new URL('../content.js', import.meta.url), 'utf8');
  for (const fixture of fixtures) {
    const page = await browser.newPage();
    // Every URL is fulfilled locally. These checks never contact BOSS, log into
    // any account, or use an existing browser profile.
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><meta charset="utf-8"><div class="cur-city-label">北京</div>' + fixture.html }));
    await page.goto('https://www.zhipin.com/web/geek/jobs?query=' + encodeURIComponent('剪辑'));
    await page.evaluate(() => { window.chrome = { runtime: { onMessage: { addListener: fn => { window.receiver = fn; } } } }; });
    await page.addScriptTag({ content: reader });
    await page.addScriptTag({ content });
    const response = await page.evaluate(() => new Promise(resolve => window.receiver(
      { channel: 'boss-collector', action: 'list', city: '北京', keyword: '剪辑' }, {}, resolve)));
    assert.equal(response.ok, true, fixture.name + ': ' + JSON.stringify(response));
    assert.equal(response.data.cards.length, fixture.count, fixture.name);
    assert.equal(response.data.end, fixture.end, fixture.name);
    console.log('PASS ' + fixture.name);
    await page.close();
  }
  console.log(`List end scope: ${fixtures.length}/${fixtures.length} local browser fixtures passed.`);
} finally {
  await browser.close();
}
