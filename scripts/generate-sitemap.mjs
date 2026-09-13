import { writeFileSync } from 'node:fs';
import { publicPages, SITE_URL } from '../src/app/content/public-pages.ts';
import { blogPosts } from '../src/app/features/blog/blog-posts.ts';

const entries = [
  ...publicPages.map(page => ({ path: page.path, updated: page.updated })),
  ...blogPosts.map(post => ({ path: post.path, updated: post.dateModified }))
];
if (new Set(entries.map(page => page.path)).size !== entries.length) {
  throw new Error('Duplicate canonical path in sitemap');
}
const xmlEscape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  entries.map(page => '  <url><loc>' + xmlEscape(SITE_URL + page.path) +
    '</loc><lastmod>' + page.updated + '</lastmod></url>').join('\n') +
  '\n</urlset>\n';
writeFileSync(new URL('../src/sitemap.xml', import.meta.url), xml);
console.log('Generated sitemap: ' + entries.length + ' canonical public pages.');
