import { writeFileSync } from 'node:fs';
import { publicPages, SITE_URL } from '../src/app/content/public-pages.ts';
import { blogPosts } from '../src/app/features/blog/blog-posts.ts';
import { gamePages } from '../src/app/content/game-pages.ts';
import { gettingStartedVideo } from '../src/app/content/getting-started-video.ts';

const entries = [
  ...publicPages.map(page => ({
    path: page.path,
    updated: page.path === '/blog'
      ? [page.updated, ...blogPosts.map(post => post.dateModified)].sort().at(-1)
      : page.updated
  })),
  ...blogPosts.map(post => ({ path: post.path, updated: post.dateModified })),
  ...gamePages.map(page => ({ path: page.path, updated: page.updated }))
];
if (new Set(entries.map(page => page.path)).size !== entries.length) {
  throw new Error('Duplicate canonical path in sitemap');
}
const xmlEscape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
// The tutorial is a watch page. Supplementary article clips remain in page schema.
const videoXml = page => page.path === gettingStartedVideo.path
  ? '\n    <video:video>\n' + [
    ['thumbnail_loc', SITE_URL + gettingStartedVideo.media + '.jpg'],
    ['title', gettingStartedVideo.name],
    ['description', gettingStartedVideo.description],
    ['content_loc', SITE_URL + gettingStartedVideo.media + '.mp4'],
    ['duration', String(gettingStartedVideo.durationSeconds)],
    ['publication_date', gettingStartedVideo.uploadDate]
  ].map(([key, value]) => `      <video:${key}>${xmlEscape(value)}</video:${key}>`).join('\n') +
    '\n    </video:video>\n  '
  : '';
const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n' +
  entries.map(page => '  <url><loc>' + xmlEscape(SITE_URL + page.path) +
    '</loc><lastmod>' + page.updated + '</lastmod>' + videoXml(page) + '</url>').join('\n') +
  '\n</urlset>\n';
writeFileSync(new URL('../src/sitemap.xml', import.meta.url), xml);
console.log('Generated sitemap: ' + entries.length + ' canonical public pages.');
