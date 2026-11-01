import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const start = process.argv[2];
const out_dir = process.argv[3];
const extra_hosts = (process.argv[4] || "").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_FETCHES = 1500;
const MAX_DEPTH = 5;
const MAX_SAVE = 8 * 1024 * 1024;
const WORKERS = 8;
const BASE_HOSTS = ["deepai.org"];
const TEXTUAL = /(javascript|json|html|css|xml|text\/)/i;
const BINARY_EXT = /\.(wasm|data|bin|png|jpe?g|gif|webp|svg|woff2?|ttf|otf|ico|mp3|mp4|ogg|zip|br|gz)(\?|#|$)/i;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const allowed = [...BASE_HOSTS, ...extra_hosts];
const hostOk = (host) => allowed.some((h) => host === h || host.endsWith("." + h));

const seen = new Set();
const discovered = new Map();
const rows = [];
const queue = [{ url: start, depth: 0, from: "" }];
const endpoints = new Map();
let fetched = 0;

function note(url, from) {
  if (!discovered.has(url)) discovered.set(url, from);
}

function noteEndpoint(value, from) {
  if (!endpoints.has(value)) endpoints.set(value, new Set());
  endpoints.get(value).add(from);
}

function extract(text, base, source) {
  const found = new Set();
  const absolute = /https?:\/\/[A-Za-z0-9.\-]+(?::\d+)?(?:\/[^\s"'`<>\\)(]*)?/g;
  for (const match of text.matchAll(absolute)) found.add(match[0].replace(/[,;.]+$/, ""));
  const relative = /["'`]((?:\.{0,2}\/)?[A-Za-z0-9_\-.\/@%+]+\.(?:js|mjs|json|css|html|txt|map))(?:\?[^"'`]*)?["'`]/g;
  for (const match of text.matchAll(relative)) {
    try {
      found.add(new URL(match[1], base).href);
    }
    catch {}
  }
  const attributes = /(?:src|href|action|data-src)=["']([^"']+)["']/g;
  for (const match of text.matchAll(attributes)) {
    try {
      found.add(new URL(match[1], base).href);
    }
    catch {}
  }
  const apiLike = /["'`](\/(?:api|v\d|chat|auth|login|logout|user|users|account|models?|upload|files?|session|token|generate|stream|history|conversation|checkout|billing|pricing|signup|register)[A-Za-z0-9_\-\/.?=&%{}$]*)["'`]/g;
  for (const match of text.matchAll(apiLike)) noteEndpoint(match[1], source);
  const sourceMap = text.match(/\/\/[#@]\s*sourceMappingURL=([^\s]+)/);
  if (sourceMap && !sourceMap[1].startsWith("data:")) {
    try {
      found.add(new URL(sourceMap[1], base).href);
    }
    catch {}
  }
  return [...found];
}

function save_path(url) {
  const parsed = new URL(url);
  let path = parsed.pathname.endsWith("/") ? parsed.pathname + "index" : parsed.pathname;
  path = path.replace(/[^A-Za-z0-9._\-\/]/g, "_").slice(-160);
  if (parsed.search) path += "__" + createHash("sha1").update(parsed.search).digest("hex").slice(0, 8);
  return join(out_dir, "files", parsed.hostname, path);
}

async function visit(item) {
  const { url, depth, from } = item;
  if (seen.has(url)) return;
  seen.add(url);
  let parsed;
  try {
    parsed = new URL(url);
  }
  catch {
    return;
  }
  if (!/^https?:$/.test(parsed.protocol) || !hostOk(parsed.hostname)) {
    rows.push([depth, "skipped", "", "", url, from]);
    return;
  }
  if (fetched >= MAX_FETCHES) {
    rows.push([depth, "limit", "", "", url, from]);
    return;
  }
  fetched++;

  const binary = BINARY_EXT.test(url);
  const headers = { "User-Agent": UA, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9" };
  if (binary) headers["Range"] = "bytes=0-1023";

  let response;
  try {
    response = await fetch(url, { headers, redirect: "follow" });
  }
  catch (error) {
    rows.push([depth, "error", "", String(error?.cause?.code || error?.message || error), url, from]);
    return;
  }

  const type = (response.headers.get("content-type") || "").split(";")[0].trim();
  const range = response.headers.get("content-range") || response.headers.get("content-length") || "";
  const server = response.headers.get("server") || "";
  rows.push([depth, response.status, type, `${range} ${server}`.trim(), url, from]);

  if (binary || !TEXTUAL.test(type)) {
    try {
      await response.body?.cancel();
    }
    catch {}
    return;
  }

  let text = "";
  try {
    text = await response.text();
  }
  catch {
    return;
  }

  if (response.status < 200 || response.status >= 300) return;

  try {
    const file = save_path(url);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text.length > MAX_SAVE ? text.slice(0, MAX_SAVE) : text);
  }
  catch {}

  if (depth >= MAX_DEPTH) return;
  for (const found of extract(text, response.url || url, url)) {
    note(found, url);
    if (!seen.has(found)) queue.push({ url: found, depth: depth + 1, from: url });
  }
}

async function worker() {
  while (true) {
    const item = queue.shift();
    if (!item) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (queue.length === 0) return;
      continue;
    }
    await visit(item);
  }
}

mkdirSync(out_dir, { recursive: true });
note(start, "");
await Promise.all(Array.from({ length: WORKERS }, () => worker()));

rows.sort((a, b) => String(a[4]).localeCompare(String(b[4])));
const header = ["depth", "status", "content_type", "size_or_server", "url", "found_in"].join("\t");
writeFileSync(join(out_dir, "index.tsv"), [header, ...rows.map((row) => row.join("\t"))].join("\n") + "\n");
writeFileSync(join(out_dir, "urls.txt"), [...discovered.keys()].sort().join("\n") + "\n");
const endpointLines = [...endpoints.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, from]) => `${value}\t${[...from].slice(0, 3).join(" ")}`);
writeFileSync(join(out_dir, "endpoints.tsv"), endpointLines.join("\n") + "\n");
console.log(`fetched ${fetched}, discovered ${discovered.size}, endpoint strings ${endpoints.size}`);
