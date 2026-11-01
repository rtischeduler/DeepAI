import { pickWisp, provisionalWisp } from "./wisps.mjs";

const DIST = "dist/sandstone.mjs";
const BASES = [
  "https://cdn.jsdelivr.net/gh/lotsacookie/Singuloxy@main/",
  "https://fastly.jsdelivr.net/gh/lotsacookie/Singuloxy@main/",
];

export async function loadSandstone(log = () => {}) {
  for (const base of BASES) {
    try {
      return await import(base + DIST);
    } catch {
      log("[proxy] sandstone import failed", base);
    }
  }
  const code = await (await fetch("https://raw.githubusercontent.com/lotsacookie/Singuloxy/main/" + DIST)).text();
  return import(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
}

export async function createProxy({ log = () => {}, say = () => {} } = {}) {
  say("Loading proxy…");
  const sandstone = await loadSandstone(log);
  provisionalWisp(sandstone.network);
  for (let i = 0; i < 300 && !sandstone.libcurl.ready; i++) await new Promise((r) => setTimeout(r, 100));
  if (!sandstone.libcurl.ready) throw new Error("libcurl did not load");
  const wisp = await pickWisp(sandstone.network, say);
  log("[proxy] wisp", wisp);
  const send = (url, init) => sandstone.libcurl.fetch(url, init);
  return { fetch: send, wisp: String(wisp), sandstone };
}
