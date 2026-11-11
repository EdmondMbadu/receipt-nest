import { workflowPages } from '../content/public-pages';

export const ACQUISITION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'rn_search_acquisition';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WORKFLOW_PATHS = new Set(workflowPages.map(page => page.path));

export interface AcquisitionParams {
  readonly organic_landing_path?: string;
  readonly article_slug?: string;
  readonly content_path?: string;
}

interface Attribution extends AcquisitionParams {
  readonly recordedAt: number;
}

export type CtaPlacement = 'header' | 'hero' | 'body' | 'end' | 'example';

function isSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 80 && SLUG.test(value);
}

function isContentPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return value === '/' || value === '/blog' || WORKFLOW_PATHS.has(value) ||
    (value.startsWith('/blog/') && isSlug(value.slice('/blog/'.length)));
}

export function cleanAcquisition(value: unknown): AcquisitionParams {
  if (!value || typeof value !== 'object') return {};
  const input = value as Record<string, unknown>;
  return {
    ...(isContentPath(input['organic_landing_path']) ? { organic_landing_path: input['organic_landing_path'] } : {}),
    ...(isSlug(input['article_slug']) ? { article_slug: input['article_slug'] } : {}),
    ...(isContentPath(input['content_path']) ? { content_path: input['content_path'] } : {})
  };
}

function readAttribution(now: number): Attribution | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Attribution | null;
    const recordedAt = stored?.recordedAt;
    if (typeof recordedAt === 'number' && recordedAt <= now && now - recordedAt <= ACQUISITION_MAX_AGE_MS) {
      return { recordedAt, ...cleanAcquisition(stored) };
    }
    window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* Storage is optional. */ }
  return null;
}

function saveAttribution(attribution: Attribution): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
  } catch { /* Storage is optional. */ }
}

export function isGoogleOrganicEntry(url: URL, referrer: string): boolean {
  if (['gclid', 'gbraid', 'wbraid', 'dclid'].some(key => url.searchParams.has(key))) return false;
  const medium = url.searchParams.get('utm_medium');
  const source = url.searchParams.get('utm_source');
  if ((medium && medium.toLowerCase() !== 'organic') || (source && source.toLowerCase() !== 'google')) return false;
  try {
    const host = new URL(referrer).hostname;
    return /^(?:www\.)?google\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})$/.test(host);
  } catch {
    return false;
  }
}

export function recordContentVisit(path: string, articleSlug?: string): void {
  if (typeof window === 'undefined' || !isContentPath(path)) return;
  const now = Date.now();
  const current = readAttribution(now) ?? { recordedAt: now };
  let landing = current.organic_landing_path;
  try {
    // The document referrer survives Angular navigation. Only the initial
    // document URL can qualify as the Google entry page.
    const navigation = window.performance.getEntriesByType('navigation')[0];
    const entry = navigation && new URL(navigation.name);
    if (!landing && entry && (entry.pathname.replace(/\/$/, '') || '/') === path &&
        isGoogleOrganicEntry(entry, document.referrer)) {
      landing = path;
    }
  } catch { /* An unavailable referrer leaves the source unknown. */ }
  const slug = current.article_slug ?? (isSlug(articleSlug) ? articleSlug : undefined);
  if (landing || slug) {
    saveAttribution({
      ...current,
      ...(landing ? { organic_landing_path: landing } : {}),
      ...(slug ? { article_slug: slug } : {})
    });
  }
  emit('content_view', {
    content_path: path,
    ...(landing ? { organic_landing_path: landing } : {}),
    ...(isSlug(articleSlug) ? { article_slug: articleSlug } : {})
  });
}

function emit(event: string, params: AcquisitionParams & { cta_placement?: CtaPlacement }): void {
  try {
    const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
    gtag?.('event', event, params);
  } catch { /* Analytics must never prevent navigation or a download. */ }
}

export function emitContentEvent(
  event: 'content_cta_click' | 'receipt_csv_sample_download',
  path: string,
  placement: CtaPlacement
): void {
  if (typeof window === 'undefined' || !isContentPath(path)) return;
  const now = Date.now();
  const current = readAttribution(now) ?? { recordedAt: now };
  const articleSlug = path.startsWith('/blog/') ? path.slice('/blog/'.length) : current.article_slug;
  const attribution = {
    ...current,
    content_path: path,
    ...(articleSlug ? { article_slug: articleSlug } : {})
  };
  // A download is a useful touch, but should not overwrite a signup CTA.
  saveAttribution(event === 'content_cta_click' ? attribution : {
    ...attribution, content_path: current.content_path ?? path
  });
  emit(event, { ...cleanAcquisition(attribution), cta_placement: placement });
}

export function consumeAcquisition(now = Date.now()): AcquisitionParams {
  if (typeof window === 'undefined') return {};
  const stored = readAttribution(now);
  if (!stored) return {};
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Storage is optional. */ }
  return cleanAcquisition({
    ...stored,
    content_path: stored.content_path ?? (stored.article_slug ? '/blog/' + stored.article_slug : stored.organic_landing_path)
  });
}
