// Local visual QA. Build Functions first. No emails are sent or account data read.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {buildSpendSummaryHtml, getSpendSummaryAttachments} = require('../functions/lib/spend-summary-template');
const {fixture, emptyFixture} = require('../functions/test/fixtures/spend-summary.cjs');
const directory = resolve('output/spend-summary-email');
mkdirSync(directory, {recursive: true});
const profile = mkdtempSync(join(tmpdir(), 'receiptnest-email-qa-'));
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const child = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start')), 15000);
    child.once('error', error => {clearTimeout(timer); reject(error);});
    child.stderr.on('data', data => {
      output += data;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {clearTimeout(timer); resolve(match[1]);}
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise(resolve => socket.addEventListener('open', resolve, {once: true}));
  let next = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (!data.id) return;
    const request = pending.get(data.id); pending.delete(data.id);
    if (data.error) request?.reject(new Error(JSON.stringify(data.error))); else request?.resolve(data.result);
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++next; pending.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params, sessionId}));
  });
  const {targetId} = await call('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await call('Target.attachToTarget', {targetId, flatten: true});
  const tab = (method, params) => call(method, params, sessionId);
  await tab('Page.enable'); await tab('Runtime.enable');
  const evaluate = async (expression, awaitPromise = false) => {
    const value = await tab('Runtime.evaluate', {expression, returnByValue: true, awaitPromise});
    if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
    return value.result.value;
  };
  const results = [];
  for (const [name, period, width, mode, variant] of [
    ['weekly-desktop', 'week', 820, 'light'], ['monthly-desktop', 'month', 820, 'light'],
    ['weekly-mobile', 'week', 390, 'light'], ['monthly-mobile', 'month', 390, 'light'],
    ['weekly-small', 'week', 320, 'light'], ['monthly-small', 'month', 320, 'light'],
    ['weekly-dark', 'week', 820, 'dark'], ['monthly-dark-mobile', 'month', 390, 'dark'],
    ['empty-weekly', 'week', 390, 'light', 'empty'], ['empty-monthly', 'month', 390, 'light', 'empty'],
    ['long-names', 'month', 320, 'light', 'long'], ['mixed-currency', 'week', 390, 'light', 'mixed'],
    ['inline-fallback', 'week', 820, 'light', 'inline'],
  ]) {
    const data = variant === 'empty' ? emptyFixture(period) : fixture(period);
    if (variant === 'mixed') data.mixedCurrencies = true;
    if (variant === 'long') {
      data.recentReceipts = data.recentReceipts.map(r => ({...r, merchantName: 'VeryLongMerchantNameWithoutSpaces'.repeat(4), categoryName: 'A detailed category with a longer name'}));
      data.categories[0].name = 'An unusually long category name which should wrap cleanly';
      data.merchants[0].name = 'VeryLongMerchantNameWithoutSpaces'.repeat(4);
    }
    let html = buildSpendSummaryHtml(data);
    for (const a of getSpendSummaryAttachments()) html = html.replaceAll('cid:' + a.contentId, 'data:' + a.type + ';base64,' + a.content);
    if (variant === 'inline') html = html.replace(/<style>[\s\S]*?<\/style>/g, '');
    writeFileSync(join(directory, name + '.html'), html);
    await tab('Emulation.setDeviceMetricsOverride', {width, height: 1100, deviceScaleFactor: 1, mobile: width < 500});
    await tab('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: mode}]});
    const {frameTree} = await tab('Page.getFrameTree');
    await tab('Page.setDocumentContent', {frameId: frameTree.frame.id, html});
    await evaluate('Promise.all(Array.from(document.images, image => image.decode()))', true);
    const info = await evaluate(`({width: innerWidth, scrollWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, images: Array.from(document.images).every(i => i.complete && i.naturalWidth > 0), background: getComputedStyle(document.body).backgroundColor, button: getComputedStyle(document.querySelector('a.rn-button')).color, overflow: Array.from(document.querySelectorAll('td,th,p,a')).filter(e => e.getBoundingClientRect().width > 0 && e.scrollWidth > e.clientWidth + 2).map(e => ({tag:e.tagName,text:e.textContent.trim().slice(0,60),width:e.clientWidth,scroll:e.scrollWidth}))})`);
    assert.ok(info.scrollWidth <= width, name + ': horizontal page overflow');
    assert.ok(info.images, name + ': broken inline images');
    assert.equal(info.overflow.length, 0, name + ': overflowing text ' + JSON.stringify(info.overflow));
    if (variant !== 'inline') assert.equal(info.background, mode === 'light' ? 'rgb(255, 255, 255)' : 'rgb(21, 30, 25)');
    assert.equal(info.button, 'rgb(255, 255, 255)', name + ': button contrast');
    const screenshot = await tab('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true, clip: {x: 0, y: 0, width, height: info.height, scale: 1}});
    writeFileSync(join(directory, name + '.png'), Buffer.from(screenshot.data, 'base64'));
    results.push({name, ...info});
  }
  writeFileSync(join(directory, 'verification.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({directory, passed: results.length, results}, null, 2));
  await call('Browser.close');
} finally { socket?.close(); child.kill(); }
