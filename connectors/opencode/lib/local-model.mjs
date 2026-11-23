// opencode connector: local and self-hosted models (connector 1.33.0, docs/local-models.md).
//
// Tandem was written for a slower model, but every default here assumed a hosted one: a large context window,
// parallel builds, an extra request per Chat answer. A model on your own hardware (Ollama, LM Studio, llama.cpp,
// vLLM) or on your company's own server has a smaller window and one GPU. This file holds the three pieces that
// change for it, all pure so they are easy to test:
//   - isLocal: is the model Tandem's runs use local or self-hosted? (the Local model setting, or a known provider)
//   - promptFit: will a Tandem command fit in the model's context window, using evals/commands.json's sizes?
//   - checkLocalModels: what `workshop doctor` says about local models in opencode's config.
//   - probeLocalServers (1.34.0): does each local model server answer, and does it have the models opencode names?
import fs from "node:fs";
import os from "node:os";
import { configSources, stripJsonc } from "./providers.mjs";

/** opencode provider ids that are always a model on your own hardware. */
export const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "llamacpp", "llama.cpp", "llama-cpp", "vllm", "localai", "jan"]);

/**
 * What opencode itself loads before a Tandem command's own text: its system prompt, the tool definitions, the
 * workspace repo map and memory.md. An estimate (it depends on the opencode version and your repo map), kept on
 * the low side so the guard warns rather than blocks when unsure.
 */
export const BASE_TOKENS = 6000;
/** Room left for the files the agent reads and its answer: past this share of the window, a run is tight. */
export const TIGHT_SHARE = 0.6;
/** Below this, doctor warns that a window is too small for Tandem at all. */
export const MIN_CONTEXT = 16384;

/** The Local model setting: "auto" (the default), "on" or "off". */
export function localSetting(v) {
  return v === "on" || v === "off" ? v : "auto";
}

/**
 * Is the model Tandem's runs use local or self-hosted? "on" and "off" decide; "auto" looks at the provider of
 * Settings' Model for agent runs (a {provider, id} or null). A company server behind its own address is not
 * recognizable, so it needs "on".
 */
export function isLocal(setting, runModel) {
  const s = localSetting(setting);
  if (s !== "auto") return s === "on";
  return !!(runModel && runModel.provider && LOCAL_PROVIDERS.has(String(runModel.provider).toLowerCase()));
}

/**
 * Will a command fit? `tokens` and `readTokens` come from eng-agents' evals/commands.json (what the command loads up
 * front, and what it reads while running); `context` is the model's window. Returns
 * {state: "unknown" | "ok" | "tight" | "over", need, context}: "over" means the command's own text plus opencode's
 * base cannot fit at all, so the model would never see its instructions; "tight" means little room is left.
 */
export function promptFit({ tokens, readTokens, context, base = BASE_TOKENS }) {
  const c = Number(context);
  const t = Number(tokens);
  if (!(c > 0) || !(t > 0)) return { state: "unknown", need: t > 0 ? t + base : null, context: c > 0 ? c : null };
  const upFront = t + base;
  const need = upFront + (Number(readTokens) > 0 ? Number(readTokens) : 0);
  const state = upFront > c ? "over" : need > c * TIGHT_SHARE ? "tight" : "ok";
  return { state, need, context: c };
}

/** The words for a fit that is not ok, or null. `name` is the command without its slash. */
export function fitMessage(name, fit) {
  if (!fit || (fit.state !== "over" && fit.state !== "tight")) return null;
  const k = (n) => `${Math.round(n / 1000)}K`;
  if (fit.state === "over") return `/${name} needs about ${k(fit.need)} tokens, but the model's context window is ${k(fit.context)}. The model would lose its instructions. Use a model with a bigger window, or raise the server's context size (docs/local-models.md).`;
  return `/${name} needs about ${k(fit.need)} of the model's ${k(fit.context)} tokens, which leaves little room for the code it reads. Expect weaker results; a bigger context size helps (docs/local-models.md).`;
}

/** {name: {tokens, readTokens}} from readCommands()' list. */
export function commandSizes(list) {
  const out = new Map();
  for (const c of list || []) if (c && c.command) out.set(c.command, { tokens: c.tokens, readTokens: c.readTokens });
  return out;
}

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

/**
 * Local models in opencode's config, for `workshop doctor`. Reads the same files as checkProviders. A provider
 * counts as local when its id is a known local one, or its options.baseURL is on this computer or a private
 * network address. Returns {state: "skipped" | "ok" | "warn" | "bad", lines}: "bad" when a window is too small for
 * Tandem, "warn" when a window is not known. Never prints a URL or a key.
 */
export function checkLocalModels({ workspace, setting, env = process.env, platform = process.platform, home = os.homedir(), readFile = (f) => fs.readFileSync(f, "utf8") }) {
  const providers = new Map(); // id -> {local, models: Map(id -> context|null)}
  for (const src of configSources({ workspace, env, platform, home })) {
    let text = src.text;
    if (text === undefined) {
      try { text = readFile(src.file); } catch { continue; }
    }
    let cfg;
    try { cfg = JSON.parse(stripJsonc(String(text).replace(/^﻿/, ""))); } catch { continue; }
    if (!isObj(cfg) || !isObj(cfg.provider)) continue;
    for (const [id, p] of Object.entries(cfg.provider)) {
      if (!isObj(p)) continue;
      const entry = providers.get(id) || { local: false, models: new Map(), url: null, apiKey: null };
      const url = isObj(p.options) ? p.options.baseURL : null;
      if (typeof url === "string" && url) entry.url = url;
      if (isObj(p.options) && typeof p.options.apiKey === "string" && p.options.apiKey) entry.apiKey = p.options.apiKey;
      // With Local model on, any provider with its own address counts (a company server on a public name).
      if (LOCAL_PROVIDERS.has(id.toLowerCase()) || privateUrl(url) || (localSetting(setting) === "on" && !!url)) entry.local = true;
      for (const [mid, m] of Object.entries(isObj(p.models) ? p.models : {})) {
        const ctx = isObj(m) && isObj(m.limit) && Number(m.limit.context) > 0 ? Number(m.limit.context) : null;
        if (ctx || !entry.models.has(mid)) entry.models.set(mid, ctx);
      }
      providers.set(id, entry);
    }
  }
  const local = [...providers.entries()].filter(([, p]) => p.local);
  if (!local.length) {
    if (localSetting(setting) === "on") return { state: "warn", lines: ["Local model: on, but no provider in opencode's config has its own address (options.baseURL). See docs/local-models.md."] };
    return { state: "skipped", lines: [] };
  }
  const lines = [];
  let warn = false;
  let bad = false;
  for (const [id, p] of local) {
    if (!p.models.size) {
      warn = true;
      lines.push(`Local model ${id}: no models listed in opencode's config, so opencode does not know their context window. Add each model with limit.context (docs/local-models.md).`);
      continue;
    }
    for (const [mid, ctx] of p.models) {
      if (!ctx) { warn = true; lines.push(`Local model ${id}/${mid}: no limit.context, so Workshop cannot check that Tandem's prompts fit. Set it to the server's real context size (docs/local-models.md).`); }
      else if (ctx < MIN_CONTEXT) { bad = true; lines.push(`Local model ${id}/${mid}: a ${ctx}-token window is too small for Tandem (about 10K to 17K tokens per command). Use 32768 or more, and set the same size on the server.`); }
      else lines.push(`Local model ${id}/${mid}: ${ctx}-token window.${id.toLowerCase() === "ollama" ? " Make sure Ollama really serves that size (OLLAMA_CONTEXT_LENGTH or num_ctx); it cuts longer prompts without an error." : ""}`);
    }
  }
  const servers = local.filter(([, p]) => p.url).map(([id, p]) => ({ id, url: p.url, apiKey: p.apiKey, models: [...p.models.keys()] }));
  return { state: bad ? "bad" : warn ? "warn" : "ok", lines, servers };
}

// opencode's {env:NAME} in a config value.
const fromEnv = (v, env) => String(v).replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n) => env[n] || "");

/**
 * Does each local model server answer? `servers` comes from checkLocalModels. Asks each one's OpenAI-style
 * `<baseURL>/models` (Ollama, LM Studio, llama.cpp, vLLM and most company gateways have it), with the provider's
 * apiKey when opencode's config has one. Returns {state, lines} like checkLocalModels: "bad" when a server does
 * not answer (every build step would fail), "warn" when it answers but does not list a model opencode names.
 * Never prints a URL or a key. `fetchFn` is for tests.
 */
export async function probeLocalServers(servers, { env = process.env, fetchFn = globalThis.fetch, timeout = 4000 } = {}) {
  const lines = [];
  let bad = false;
  let warn = false;
  for (const s of servers || []) {
    let url;
    try { url = new URL(String(s.url).replace(/\/+$/, "") + "/models"); } catch { continue; }
    const headers = {};
    const key = s.apiKey ? fromEnv(s.apiKey, env) : "";
    if (key) headers.authorization = `Bearer ${key}`;
    let r;
    try {
      r = await fetchFn(url, { headers, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      bad = true;
      const why = e && (e.name === "TimeoutError" || e.name === "AbortError") ? `no answer in ${Math.round(timeout / 1000)} seconds` : "could not connect";
      lines.push(`Local model server ${s.id}: not answering (${why}). Every build step would fail. Start it (Ollama: ollama serve), or connect to the network or VPN it is on, then run doctor again.`);
      continue;
    }
    if (r.status === 401 || r.status === 403) {
      warn = true;
      lines.push(`Local model server ${s.id}: answers, but refused the request (${r.status}). Check the key opencode uses for it (opencode auth login, or options.apiKey).`);
      continue;
    }
    if (!r.ok) {
      warn = true;
      lines.push(`Local model server ${s.id}: answers, but its model list gave HTTP ${r.status}, so its models were not checked.`);
      continue;
    }
    let have = null;
    try {
      const j = await r.json();
      const list = Array.isArray(j && j.data) ? j.data : Array.isArray(j && j.models) ? j.models : null;
      if (list) have = new Set(list.map((m) => String((m && (m.id || m.name || m.model)) || "")).filter(Boolean));
    } catch { /* not JSON: answering is enough */ }
    const missing = have && have.size ? s.models.filter((m) => !have.has(m) && !have.has(`${m}:latest`)) : [];
    if (missing.length) {
      warn = true;
      lines.push(`Local model server ${s.id}: answering, but it does not list ${missing.join(", ")}. Pull it (Ollama: ollama pull <model>) or fix the model id in opencode's config.`);
    } else lines.push(`Local model server ${s.id}: answering.`);
  }
  return { state: bad ? "bad" : warn ? "warn" : lines.length ? "ok" : "skipped", lines };
}

/** True for an http(s) URL on this computer or a private network (10/8, 172.16/12, 192.168/16, .local, .internal). */
export function privateUrl(url) {
  let h;
  try { h = new URL(String(url || "")).hostname.toLowerCase(); } catch { return false; }
  if (!h) return false;
  if (h === "localhost" || h === "[::1]" || h === "::1" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
