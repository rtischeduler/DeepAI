const API = "https://api.deepai.org";
const SITE = "https://deepai.org";

const md5Reversed = (function () {
  const a = [];
  for (let b = 0; 64 > b;) a[b] = 0 | 4294967296 * Math.sin(++b % Math.PI);
  return function (input) {
    let d, e, f, g = [d = 1732584193, e = 4023233417, ~d, ~e], h = [], l = unescape(encodeURI(input)) + "\u0080", k = l.length;
    let c = --k / 4 + 2 | 15;
    for (h[--c] = 8 * k; ~k;) h[k >> 2] |= l.charCodeAt(k) << 8 * k--;
    for (let b = 0, l = 0; b < c; b += 16) {
      for (k = g; 64 > l;) k = [f = k[3], d + ((f = k[0] + [d & e | ~d & f, f & d | ~f & e, d ^ e ^ f, e ^ (d | ~f)][k = l >> 4] + a[l] + ~~h[b | [l, 5 * l + 1, 3 * l + 5, 7 * l][k] & 15]) << (k = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21][4 * k + l++ % 4]) | f >>> -k), d, e];
      d = k[1] | 0, e = k[2];
      for (l = 4; l;) g[--l] += k[l];
    }
    let result = "";
    for (let l = 0; 32 > l;) result += (g[l >> 3] >> 4 * (1 ^ l++) & 15).toString(16);
    return result.split("").reverse().join("");
  };
})();

export function generateApiKey(userAgent) {
  const random = Math.round(Math.random() * 100000000000) + "";
  const inner = md5Reversed(userAgent + random + "hackers_become_a_little_stinkier_every_time_they_hack");
  const middle = md5Reversed(userAgent + inner);
  const outer = md5Reversed(userAgent + middle);
  return "tryit-" + random + "-" + outer;
}

// The site sends every attachment uuid of the whole conversation with each chat request, not only the new ones.
export function collectAttachmentUuids(messages = [], attachments = []) {
  const ids = [];
  const add = (value) => {
    const id = typeof value === "string" ? value : value && value.uuid;
    if (id && !ids.includes(id)) ids.push(id);
  };
  for (const message of messages || []) {
    for (const value of message.attachment_uuids || []) add(value);
    for (const value of message.attachments || []) add(value);
  }
  for (const value of attachments || []) add(value);
  return ids;
}

export class DeepAIError extends Error {
  constructor(message, { status = 0, code = "", body = null } = {}) {
    super(message);
    this.name = "DeepAIError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export function createCookieJar(initial = {}) {
  const jar = new Map(Object.entries(initial));
  const splitSetCookie = (headers) => {
    if (typeof headers.getSetCookie === "function") {
      const list = headers.getSetCookie();
      if (list.length) return list;
    }
    const raw = headers.get("set-cookie");
    return raw ? raw.split(/,(?=\s*[A-Za-z0-9_.\-]+=)/) : [];
  };
  return {
    absorb(headers) {
      for (const line of splitSetCookie(headers)) {
        const pair = line.split(";")[0];
        const eq = pair.indexOf("=");
        if (eq < 1) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        const expired = /max-age=0|expires=thu, 01 jan 1970/i.test(line);
        if (expired || value === "") jar.delete(name);
        else jar.set(name, value);
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    get: (name) => jar.get(name),
    set: (name, value) => jar.set(name, value),
    toObject: () => Object.fromEntries(jar),
    clear: () => jar.clear(),
  };
}

const uuid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0;
  return (c === "x" ? r : (r & 3 | 8)).toString(16);
}));

const MODEL_RE = /\{"value":"([^"]+)","label":"([^"]*)"(?:,"locked":(true|false))?/g;

export function parseModels(html) {
  const seen = new Map();
  for (const m of html.matchAll(MODEL_RE)) {
    if (!seen.has(m[1])) seen.set(m[1], { id: m[1], label: m[2], locked: m[3] === "true" });
  }
  return [...seen.values()];
}

export function createClient({
  fetch: send = globalThis.fetch,
  api = API,
  site = SITE,
  language = "en",
  userAgent = (globalThis.navigator && navigator.userAgent) || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  cookies = createCookieJar(),
  log = (...args) => console.log(...args),
} = {}) {
  const baseHeaders = (extra = {}) => {
    const headers = { "User-Agent": userAgent, "Origin": site, "Referer": site + "/chat", ...extra };
    if (language !== "en") headers["X-DeepAI-Language"] = language;
    const cookie = cookies.header();
    if (cookie) headers.Cookie = cookie;
    return headers;
  };

  const describeBody = (b) => {
    if (b == null) return "none";
    if (typeof b === "string") return "string(" + b.length + ")";
    if (typeof FormData !== "undefined" && b instanceof FormData) {
      return "FormData{" + [...b.entries()].map(([k, v]) => k + "=" + (typeof v === "string" ? (v.length > 120 ? v.slice(0, 120) + "..." : v) : "File(" + (v.name || "") + "," + (v.type || "") + "," + (v.size || 0) + "b)")).join(", ") + "}";
    }
    return String(b.constructor && b.constructor.name || "body");
  };

  async function raw(path, init = {}) {
    const url = path.startsWith("http") ? path : api + path;
    const response = await send(url, { redirect: "follow", ...init, headers: baseHeaders(init.headers) });
    cookies.absorb(response.headers);
    log("[deepai]", init.method || "GET", url, response.status, response.headers.get("content-type") || "", "cookies:", Object.keys(cookies.toObject()).join(",") || "none", "body:", describeBody(init.body));
    return response;
  }

  async function json(path, init) {
    const response = await raw(path, init);
    const text = await response.text().catch(() => "");
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {}
    if (!response.ok) {
      log("[deepai] error body", response.status, path.split("?")[0], text.slice(0, 2000));
      const code = body && (body.status || body.error || body.detail) || "";
      throw new DeepAIError(String(code || "HTTP " + response.status + (text ? ": " + text.replace(/\s+/g, " ").slice(0, 200) : "")), { status: response.status, code: String(code), body });
    }
    return body;
  }

  const form = (fields) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) if (value !== undefined && value !== null) data.append(key, value);
    return data;
  };

  return {
    cookies,
    raw,

    async userLoginType(email) {
      return json("/get_user_login_type", { method: "POST", body: form({ email }) });
    },

    async login(email, password) {
      const type = await this.userLoginType(email);
      if (!type.user_exists) throw new DeepAIError("No account for this email", { code: "no_account", body: type });
      if (!type.login_with_password) {
        const via = (type.login_with_social_accounts || [])[0] || "a social account";
        throw new DeepAIError("This account signs in with " + via, { code: "social_only", body: type });
      }
      await json("/daily-time-sync/login/", { method: "POST", body: form({ username: email, password }) });
      return this.me();
    },

    async logout() {
      try {
        await raw("/daily-time-sync/logout/", { method: "POST" });
      } finally {
        cookies.clear();
      }
    },

    async me() {
      const response = await raw("/daily-time-sync/user/");
      if (response.status === 200) return response.json();
      return null;
    },

    async usage() {
      return json("/get_usage_summary?page=all", { headers: { "Cache-Control": "no-store" } });
    },

    async listModels() {
      const response = await raw(site + "/chat");
      if (!response.ok) throw new DeepAIError("Could not load model list", { status: response.status });
      const models = parseModels(await response.text());
      if (!models.length) throw new DeepAIError("No models found on the chat page", { code: "no_models" });
      return models;
    },

    async uploadAttachment(file, name) {
      if (!file) throw new DeepAIError("file is required", { code: "no_file" });
      // Same as the site: plain multipart "file" field to /chat_attachments/upload, session cookies only, no api-key header.
      const data = new FormData();
      if (name) data.append("file", file, name);
      else data.append("file", file);
      log("[deepai] upload", name || file.name || "", file.type || "", file.size || 0, "bytes");
      const body = await json("/chat_attachments/upload", { method: "POST", body: data });
      log("[deepai] upload response", JSON.stringify(body));
      if (!body.success || !body.attachment) throw new DeepAIError(body.error || "Upload failed", { body });
      return body.attachment;
    },

    async getAttachment(attachmentUuid) {
      const body = await json("/chat_attachments/get?uuid=" + encodeURIComponent(attachmentUuid));
      if (!body.success || !body.attachment) throw new DeepAIError(body.error || "Failed to get attachment", { body });
      return body.attachment;
    },

    async getSession(sessionUuid) {
      return json("/get_chat_session?include_sensitivity=1&uuid=" + encodeURIComponent(sessionUuid));
    },

    async listSessions() {
      return json("/get_my_chat_sessions_and_convert_anonymous_sessions");
    },

    async taskStatus(taskId, type = "thinking-task") {
      return json(`/check_chat_task_status?type=${encodeURIComponent(type)}&task_id=${encodeURIComponent(taskId)}`);
    },

    async *chat({
      model,
      messages,
      attachments = [],
      sessionUuid = uuid(),
      chatStyle = "chat",
      memory,
      webAccess,
      tools = ["image_generator", "image_editor"],
      signal,
    }) {
      if (!model) throw new DeepAIError("model is required");
      if (!Array.isArray(messages) || !messages.length) throw new DeepAIError("messages are required");
      const fields = {
        chat_style: chatStyle,
        language,
        chatHistory: JSON.stringify(messages),
        model,
        session_uuid: sessionUuid,
        sensitivity_request_id: uuid(),
        tool_activity_support: "1",
        thinking_image_tool_support: "1",
        hacker_is_stinky: "very_stinky",
        enabled_tools: JSON.stringify(tools),
      };
      if (memory !== undefined) fields.memory_enabled = memory ? "true" : "false";
      if (webAccess !== undefined) fields.web_access_enabled = webAccess ? "true" : "false";
      const attachmentIds = collectAttachmentUuids(messages, attachments);
      if (attachmentIds.length) fields.attachment_uuids = JSON.stringify(attachmentIds);
      log("[deepai] chat fields", { ...fields, chatHistory: "(" + fields.chatHistory.length + " chars, " + messages.length + " messages)" });
      const response = await raw("/hacking_is_a_serious_crime", {
        method: "POST",
        body: form(fields),
        signal,
        headers: { "api-key": generateApiKey(userAgent) },
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        let body = null;
        try {
          body = JSON.parse(text);
        } catch {}
        log("[deepai] chat error body", response.status, text.slice(0, 2000));
        const code = body && body.status || "";
        throw new DeepAIError(String(code || "HTTP " + response.status + (text ? ": " + text.replace(/\s+/g, " ").slice(0, 200) : "")), { status: response.status, code: String(code), body });
      }
      const type = response.headers.get("content-type") || "";
      if (type.includes("application/json")) {
        const body = await response.json();
        yield { type: "json", value: body };
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        yield { type: "text", value: decoder.decode(value, { stream: true }) };
      }
      const tail = decoder.decode();
      if (tail) yield { type: "text", value: tail };
    },

    async ask(options) {
      let text = "";
      let last = null;
      for await (const part of this.chat(options)) {
        if (part.type === "text") text += part.value;
        else last = part.value;
      }
      return last && !text ? last : text;
    },

    sessionId: uuid,
  };
}
