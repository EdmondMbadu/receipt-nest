// Local-only visual smoke test. Requires Node 22.20+ and Chrome; no extra browser package.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const origin = process.env.SEO_PREVIEW_ORIGIN || 'http://127.0.0.1:5002';
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, 'Only a local preview is allowed');
const directory = mkdtempSync(join(tmpdir(), 'receiptnest-seo-qa-'));
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const processHandle = spawn(chrome, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--remote-debugging-port=0',
  '--user-data-dir=' + join(directory, 'profile'), 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start')), 15000);
    processHandle.once('error', error => { clearTimeout(timer); reject(error); });
    processHandle.stderr.on('data', data => {
      output += data;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  const pending = new Map();
  let id = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request?.reject(new Error(JSON.stringify(message.error)));
    else request?.resolve(message.result);
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params, sessionId }));
  });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const tab = (method, params) => call(method, params, sessionId);
  await tab('Page.enable');
  await tab('Runtime.enable');
  await tab('Network.enable');
  // Do not send QA visits to production analytics or access account services.
  await tab('Network.setBlockedURLs', { urls: [
    '*googletagmanager.com/*', '*google-analytics.com/*', '*googleadservices.com/*',
    '*doubleclick.net/*', '*firestore.googleapis.com/*', '*identitytoolkit.googleapis.com/*'
  ] });
  const evaluate = async expression => (await tab('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  const results = [];
  for (const [path, width, name] of [
    ['/receipt-to-csv', 390, 'csv-mobile'],
    ['/receipt-tracker', 390, 'tracker-mobile'],
    ['/pricing', 390, 'pricing-mobile'],
    ['/blog/receiptnest-vs-expensify', 390, 'comparison-mobile'],
    ['/', 1440, 'home-desktop'],
    ['/receipt-to-csv', 1440, 'csv-desktop']
  ]) {
    await tab('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
    await tab('Page.navigate', { url: origin + path });
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      ready = await evaluate('document.readyState !== "loading" && !!document.querySelector("h1")');
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(ready, path + ': no visible heading');
    await new Promise(resolve => setTimeout(resolve, 700));
    const result = await evaluate('({path:location.pathname,title:document.title,h1:document.querySelector("h1")?.textContent.trim(),viewport:innerWidth,bodyWidth:document.body.scrollWidth,mainWidth:document.querySelector("main")?.scrollWidth,canonical:document.querySelector("link[rel=canonical]")?.href,applications:document.querySelectorAll("#json-ld-software-application").length})');
    assert.equal(result.path, path);
    assert.equal(result.canonical, 'https://receipt-nest.com' + path);
    assert.ok(result.bodyWidth <= width + 1, path + ': horizontal page overflow');
    if (path === '/') assert.equal(result.h1, 'Finally know where your money goes.');
    const screenshot = await tab('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = join(directory, name + '.png');
    writeFileSync(file, Buffer.from(screenshot.data, 'base64'));
    results.push({ ...result, screenshot: file });
  }
  console.log(JSON.stringify({ directory, results }, null, 2));
  await call('Browser.close');
} finally {
  socket?.close();
  processHandle.kill();
}
