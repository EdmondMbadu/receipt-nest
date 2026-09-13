import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { parse } from 'parse5';
import { publicPages, SITE_URL } from '../src/app/content/public-pages.ts';
import { receiptWorkflows } from '../src/app/content/receipt-workflows.ts';
import { blogPosts, getBlogPost } from '../src/app/features/blog/blog-posts.ts';
import { getBlogEditorial } from '../src/app/features/blog/blog-editorial.ts';

const root = 'dist/receipt-nest/browser';
const read = path => readFileSync(path, 'utf8');
const attr = (node, key) => node.attrs?.find(item => item.name === key)?.value;
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
const nodes = node => [node, ...(node.childNodes || []).flatMap(nodes)];
const entries = [
  ...publicPages,
  ...blogPosts.map(post => ({ ...post, title: post.seoTitle + ' | ReceiptNest AI' }))
];
const documents = new Map(entries.map(page => {
  const file = join(root, page.path, 'index.html');
  assert.ok(existsSync(file), 'Missing pre-render: ' + page.path);
  return [page.path, nodes(parse(read(file)))];
}));
const sitemap = read(join(root, 'sitemap.xml'));
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
assert.deepEqual(new Set(urls), new Set(entries.map(page => SITE_URL + page.path)), 'Sitemap must contain exactly the canonical public pages');
assert.equal(urls.length, entries.length, 'No duplicate sitemap URLs');
assert.equal(sitemap, read('src/sitemap.xml'), 'Built sitemap is stale; rebuild');
const titles = new Set();
const descriptions = new Set();
const privatePaths = ['/login', '/register', '/email-verified', '/feedback', '/app'];
let linksChecked = 0;
for (const page of entries) {
  const all = documents.get(page.path);
  const tags = name => all.filter(node => node.tagName === name);
  const meta = key => tags('meta').filter(node => attr(node, 'name') === key);
  assert.equal(tags('title').length, 1, page.path + ': exactly one title');
  assert.equal(text(tags('title')[0]), page.title, page.path + ': title matches registry');
  assert.ok(!titles.has(page.title), page.path + ': duplicate title');
  titles.add(page.title);
  assert.equal(meta('description').length, 1, page.path + ': one description');
  const description = attr(meta('description')[0], 'content');
  assert.equal(description, page.description, page.path + ': description matches registry');
  assert.ok(!descriptions.has(description), page.path + ': duplicate description');
  descriptions.add(description);
  const canonical = tags('link').filter(node => attr(node, 'rel') === 'canonical');
  assert.equal(canonical.length, 1, page.path + ': one canonical');
  assert.equal(attr(canonical[0], 'href'), SITE_URL + page.path, page.path + ': self canonical');
  assert.equal(attr(meta('robots')[0], 'content'), 'index, follow', page.path + ': public indexing');
  assert.equal(tags('h1').length, 1, page.path + ': one H1');
  assert.ok(text(tags('h1')[0]).trim().length > 5, page.path + ': useful H1');
  if (page.path === '/') assert.equal(text(tags('h1')[0]).trim(), 'Finally know where your money goes.', 'Preserve the owner-approved homepage hero');
  assert.ok(tags('main').length, page.path + ': main landmark');
  const graphs = tags('script').filter(node => attr(node, 'type') === 'application/ld+json')
    .flatMap(node => { const json = JSON.parse(text(node)); return json['@graph'] || [json]; });
  const types = graphs.map(node => node['@type']);
  assert.ok(types.includes('Organization') && types.includes('WebSite'), page.path + ': brand entities');
  assert.equal(types.filter(type => type === 'SoftwareApplication').length,
    page.kind === 'home' || page.kind === 'workflow' || page.path === '/pricing' ? 1 : 0,
    page.path + ': application schema belongs only on product pages');
  assert.ok(!types.includes('FAQPage'), page.path + ': no retired FAQ enhancement markup');
  if (page.slug) {
    const article = graphs.find(node => node['@type'] === 'BlogPosting');
    assert.equal(article?.author?.url, SITE_URL + '/about', page.path + ': identifiable publisher-author');
    getBlogEditorial(page.slug);
  } else {
    assert.equal(all.filter(node => node.tagName === 'meta' && attr(node, 'property')?.startsWith('article:')).length, 0, page.path + ': no stale article metadata');
  }
  for (const link of tags('a')) {
    const href = attr(link, 'href');
    if (!href || /^(mailto:|tel:|javascript:)/.test(href)) continue;
    const url = new URL(href, SITE_URL + page.path);
    if (url.origin !== SITE_URL) continue;
    const target = documents.get(url.pathname);
    if (target) {
      if (url.hash) assert.ok(target.some(node => attr(node, 'id') === decodeURIComponent(url.hash.slice(1))), page.path + ': broken fragment ' + href);
    } else {
      assert.ok(privatePaths.includes(url.pathname) || existsSync(join(root, url.pathname)), page.path + ': broken local link ' + href);
    }
    linksChecked++;
  }
  for (const img of tags('img')) {
    assert.ok(attr(img, 'alt') !== undefined, page.path + ': image missing alt');
    const url = new URL(attr(img, 'src'), SITE_URL);
    if (url.origin === SITE_URL) assert.ok(existsSync(join(root, url.pathname)), page.path + ': missing image ' + url.pathname);
  }
}
for (const page of publicPages.filter(page => page.kind === 'workflow')) {
  const workflow = receiptWorkflows[page.path.slice(1)];
  assert.ok(workflow?.steps.length && workflow.example.rows.length, page.path + ': needs useful workflow and example');
}
assert.equal(getBlogPost('this-article-does-not-exist'), undefined, 'Unknown articles cannot silently become another article');
for (const path of ['login', 'register', 'email-verified']) {
  const all = nodes(parse(read(join(root, path, 'index.html'))));
  assert.ok(all.some(node => attr(node, 'name') === 'robots' && attr(node, 'content')?.includes('noindex')), path + ': noindex required');
  assert.ok(!all.some(node => node.tagName === 'link' && attr(node, 'rel') === 'canonical'), path + ': no marketing canonical on account page');
}
const hosting = JSON.parse(read('firebase.json')).hosting;
const noindex = path => hosting.headers.some(rule => matchesGlob(path, rule.source) &&
  rule.headers.some(header => header.key === 'X-Robots-Tag' && header.value.includes('noindex')));
for (const path of ['/app', '/app/receipt/example', '/share/example', '/mobile-return/login',
  '/home', '/login', '/register', '/email-verified', '/verify', '/reset-password', '/feedback',
  '/goodbye', '/unsubscribe', '/samples/receiptnest-monthly-example.csv']) {
  assert.ok(noindex(path), path + ': missing response-level noindex rule');
}
for (const page of entries) assert.ok(!noindex(page.path), page.path + ': public page accidentally blocked');
assert.ok(!hosting.rewrites.some(rule => rule.source === '**'), 'No catch-all rewrite that turns missing pages into HTTP 200');
assert.ok(read(join(root, '404.html')).includes('noindex'), 'Static 404 needs noindex');
const sample = read(join(root, 'samples/receiptnest-monthly-example.csv')).trim().split(/\r?\n/);
assert.equal(sample[0], 'Merchant,Date,Amount', 'Sample columns match monthly export');
const rows = sample.slice(1).map(row => row.split(','));
assert.equal(rows.slice(0, -1).reduce((sum, row) => sum + Math.round(Number(row[2]) * 100), 0), Math.round(Number(rows.at(-1)[2]) * 100), 'Sample total must reconcile');
console.log('SEO checks passed: ' + entries.length + ' public pages, 3 account pages, ' + linksChecked + ' local links; sitemap, schema, images, private-route headers, and sample CSV verified.');
