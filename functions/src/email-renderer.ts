import { load } from "cheerio";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import ipaddr from "ipaddr.js";
import type { Browser } from "puppeteer-core";

const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const MAX_ASSETS = 24;
const ASSET_BUDGET_MS = 6000;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const IMAGE_DATA = /^data:image\/(?:png|jpeg|jpg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

export function publicAssetUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Unsupported asset URL");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host.includes(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) || ipaddr.isValid(host)) throw new Error("Unsupported asset host");
  return url;
}

export function publicAssetAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === "unicast"; } catch { return false; }
}

/** Resolve, validate and pin DNS for every hop. The browser itself never accesses the network. */
async function fetchImage(value: string, deadline: number, redirects = 0): Promise<string> {
  const url = publicAssetUrl(value);
  const remaining = deadline - Date.now();
  if (remaining <= 0 || redirects > 3) throw new Error("Asset budget exhausted");
  let dnsTimer: NodeJS.Timeout | undefined;
  const records = await Promise.race([
    lookup(url.hostname, { all: true }),
    new Promise<never>((_, reject) => { dnsTimer = setTimeout(() => reject(new Error("DNS timeout")), Math.min(remaining, 1800)); }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (!records.length || records.some(r => !publicAssetAddress(r.address))) throw new Error("Private asset destination");
  return new Promise<string>((resolve, reject) => {
    const pinned = records[0];
    const req = request(url, { method: "GET", family: pinned.family, headers: { "User-Agent": "ReceiptNest-EmailCapture/2", Accept: "image/*" },
      lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
    }, response => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        fetchImage(new URL(response.headers.location, url).href, deadline, redirects + 1).then(resolve, reject);
        return;
      }
      const mime = String(response.headers["content-type"] || "").split(";")[0].toLowerCase();
      if (status !== 200 || !/^image\/(?:png|jpeg|gif|webp|avif)$/.test(mime) || Number(response.headers["content-length"]) > MAX_ASSET_BYTES) {
        response.destroy(); reject(new Error("Unsupported image response")); return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_ASSET_BYTES) { response.destroy(); reject(new Error("Image too large")); }
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve(`data:${mime};base64,${Buffer.concat(chunks).toString("base64")}`));
    });
    const timer = setTimeout(() => req.destroy(new Error("Image timeout")), Math.max(1, Math.min(2500, deadline - Date.now())));
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end();
  });
}

export async function freezeEmailAssets(html: string, fetchAsset = fetchImage): Promise<{ html: string; missingAssets: number }> {
  const $ = load(html);
  const urls = new Set<string>();
  const collect = (value: string) => {
    if (!IMAGE_DATA.test(value)) { try { urls.add(publicAssetUrl(value).href); } catch { /* blocked */ } }
  };
  $("img[src]").each((_, el) => collect($(el).attr("src") || ""));
  $("[background]").each((_, el) => collect($(el).attr("background") || ""));
  const cssUrls = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  $("style,[style]").each((_, el) => {
    const css = el.tagName === "style" ? $(el).html() || "" : $(el).attr("style") || "";
    for (const match of css.matchAll(cssUrls)) collect(match[2]);
  });
  const assets = new Map<string, string>();
  const deadline = Date.now() + ASSET_BUDGET_MS;
  const pending = [...urls].slice(0, MAX_ASSETS);
  let totalBytes = 0;
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (pending.length && Date.now() < deadline) {
      const url = pending.shift()!;
      try {
        const data = await fetchAsset(url, deadline);
        if (IMAGE_DATA.test(data) && totalBytes + data.length <= 10 * 1024 * 1024) { totalBytes += data.length; assets.set(url, data); }
      } catch { /* Missing image does not discard the email. */ }
    }
  }));
  let missingAssets = 0;
  const resolve = (value: string) => {
    if (IMAGE_DATA.test(value) && value.length <= MAX_ASSET_BYTES * 1.4) return value;
    let key = value;
    try { key = publicAssetUrl(value).href; } catch { /* unsupported */ }
    const data = assets.get(key);
    if (!data && value) missingAssets++;
    return data || "";
  };
  $("img").each((_, el) => {
    const src = resolve($(el).attr("src") || "");
    if (src) $(el).attr("src", src);
    else $(el).removeAttr("src");
    $(el).removeAttr("srcset");
  });
  $("[background]").each((_, el) => { const src = resolve($(el).attr("background") || ""); if (src) $(el).attr("background", src); else $(el).removeAttr("background"); });
  $("style,[style]").each((_, el) => {
    const isStyle = el.tagName === "style";
    const css = isStyle ? $(el).html() || "" : $(el).attr("style") || "";
    const offline = css.replace(cssUrls, (_match, _quote, url) => { const src = resolve(url); return src ? `url("${src}")` : "none"; });
    if (isStyle) $(el).text(offline); else $(el).attr("style", offline);
  });
  return { html: $.html(), missingAssets };
}

let browserPromise: Promise<Browser> | undefined;
async function browser(): Promise<Browser> {
  if (!browserPromise) browserPromise = (async () => {
    const puppeteer = await import("puppeteer-core");
    const executablePath = process.env.EMAIL_CHROME_EXECUTABLE;
    const chromium = executablePath ? undefined : (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({ executablePath: executablePath || await chromium!.executablePath(),
      // Chromium's Lambda --single-process default crashes when opening isolated browser contexts.
      // Gen 2 supports renderer processes; retain per-email context isolation and browser reuse.
      args: chromium?.args.filter(arg => arg !== "--single-process") || ["--no-sandbox", "--disable-setuid-sandbox"], headless: "shell", timeout: 20000,
      dumpio: !executablePath,
      defaultViewport: { width: 900, height: 1000, deviceScaleFactor: 1 } });
  })().catch(error => { browserPromise = undefined; throw error; });
  const instance = await browserPromise;
  if (!instance.connected) { browserPromise = undefined; return browser(); }
  return instance;
}

export async function renderEmailPdf(html: string): Promise<Buffer> {
  const instance = await browser();
  const context = await instance.createBrowserContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", req => { void (req.url().startsWith("data:") || req.url() === "about:blank" ? req.continue() : req.abort()); });
    await page.emulateMediaType("screen");
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    await page.setContent(html, { waitUntil: "load", timeout: 15000 });
    // Scale desktop email tables to the printable width without cropping their right-hand columns.
    const width = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth));
    const pdf = Buffer.from(await page.pdf({ format: "Letter", printBackground: true, preferCSSPageSize: false,
      margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
      scale: Math.max(0.1, Math.min(1, 740 / width)), timeout: 20000 }));
    if (pdf.length > MAX_PDF_BYTES) throw new Error("Rendered email PDF exceeds 10 MB");
    return pdf;
  } finally {
    await context.close().catch(async () => {
      browserPromise = undefined;
      await instance.close().catch(() => undefined);
    });
  }
}

export async function closeEmailBrowser(): Promise<void> {
  const current = browserPromise;
  browserPromise = undefined;
  if (current) await (await current).close();
}
