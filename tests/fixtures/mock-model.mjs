// A stand-in for a local model server (Ollama's OpenAI-compatible /v1 API), for tests/cleanup-e2e.py. Real opencode
// talks to it as it would to Ollama; it answers like a small model would, from the prompt alone. No network, no
// weights, synthetic text only.
//
//   node tests/fixtures/mock-model.mjs [--style clean|sloppy]
//
// Prints one JSON line {url} when listening (the base URL, ending in /v1). Then reads commands, one JSON per line:
//   {"style": "clean"|"sloppy"}   how the next replies look ("sloppy": no end markers, a code fence, chatter first)
//   {"requests": true}            the requests seen: [{chars, hasInput, tools, quick, notes, effort}] (chars: the whole prompt's length;
//                                 effort: the reasoning effort opencode sent, from a model variant)
//   {"chat": {firstMs, everyMs, size, text, quickText}}   chat replies (tests/chat-e2e.py): a request that sends tools gets `text`
//                                 streamed `size` characters every `everyMs`, after `firstMs`, like a slow local model
// Stops when stdin closes.
//
// For a Notes clean up prompt (apps/notes/js/cleanup.js) it does what the prompt asks, simply: each template section
// gets the input lines whose words match it, the rest go under "Other notes", and lines get a capital letter and a
// full stop. Any other request (opencode's title step) gets a short title.
import http from "node:http";
import readline from "node:readline";

let style = process.argv.includes("--style") ? process.argv[process.argv.indexOf("--style") + 1] : "clean";
const seen = [];
let chat = null; // {firstMs, everyMs, size, text}: how chat replies stream (tests/chat-e2e.py)

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const sentence = (s) => { const t = cap(s.trim()); return /[.!?:]$/.test(t) || !t ? t : `${t}.`; };

/** The model's answer to a clean up prompt. */
export function answer(prompt) {
  const input = (/<<<INPUT\n([\s\S]*?)\nINPUT>>>/.exec(prompt) || [])[1] || "";
  // Only the template's sections: opencode puts its own instructions (with their own ## headings) in the same request.
  const list = (/Its sections, in this order:\n((?:## .+\n)+)/.exec(prompt) || [])[1] || "";
  const outline = [...list.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const lines = input.split("\n");
  const title = cap(((lines.find((l) => /^#\s/.test(l)) || "# Untitled").replace(/^#\s+/, "")).trim());
  // Label-only lines ("action items:") are dropped; their items follow them.
  const body = lines.filter((l) => l.trim() && !/^#\s/.test(l) && !/^[a-z ]{2,30}:\s*$/i.test(l.trim())).map((l) => l.trim());
  const used = new Set();
  const words = (s) => s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
  const KEYS = { attendees: ["who:", "attendees"], notes: ["agenda", "notes"], decisions: ["decision"], "action items": ["[ ]", " to "] };
  // The most specific sections take their lines first, then the output keeps the template's order.
  const order = [...outline].sort((a, b) => (KEYS[a.toLowerCase()] ? 0 : 1) - (KEYS[b.toLowerCase()] ? 0 : 1)).reverse();
  const picked = {};
  for (const h of order) {
    const keys = KEYS[h.toLowerCase()] || words(h);
    picked[h] = body.filter((l, i) => !used.has(i) && keys.some((k) => l.toLowerCase().includes(k)) && used.add(i));
  }
  const item = (l) => (/^- \[ \] /.test(l) ? `- [ ] ${sentence(l.slice(6))}` : /^- /.test(l) ? `- ${sentence(l.slice(2))}` : `- ${sentence(l.replace(/^[a-z ]+:\s*/i, ""))}`);
  const sections = outline.map((h) => `## ${h}\n\n${picked[h].length ? picked[h].map(item).join("\n") : "TBD"}`);
  const rest = body.filter((_, i) => !used.has(i));
  const doc = outline.length
    ? [`# ${title}`, ...sections, ...(rest.length ? [`## Other notes\n\n${rest.map((l) => `- ${sentence(l)}`).join("\n")}`] : [])].join("\n\n")
    : [`# ${title}`, body.map(sentence).join(" ")].join("\n\n");
  const feedback = ["- Add the date of the meeting.", "- Say who owns each action item.", "- Check the release day with the team."];
  if (style === "sloppy") return `Sure! Here is the cleaned up document.\n\n<<<DOCUMENT\n\`\`\`markdown\n${doc}\n\`\`\`\n\n<<<FEEDBACK\n${feedback.join("\n")}`;
  return `<<<DOCUMENT\n${doc}\nDOCUMENT>>>\n<<<FEEDBACK\n${feedback.join("\n")}\nFEEDBACK>>>`;
}

function textOf(messages) {
  return (messages || []).map((m) => (typeof m.content === "string" ? m.content : (m.content || []).map((p) => p.text || "").join(""))).join("\n");
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.method === "GET" && /\/models$/.test(req.url)) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: [{ id: "qwen-mock", object: "model" }] }));
    }
    if (!/\/chat\/completions$/.test(req.url)) { res.writeHead(404); return res.end(); }
    let body = {};
    try { body = JSON.parse(raw); } catch { /* empty */ }
    const all = textOf(body.messages);
    const last = textOf((body.messages || []).filter((m) => m.role === "user").slice(-1));
    const isCleanup = last.includes("<<<INPUT");
    const isQuick = all.includes("You answer quick questions");
    seen.push({ warm: last.includes("Reply with the single word OK"), chars: all.length, hasInput: isCleanup, tools: (body.tools || []).length, quick: isQuick, notes: [...all.matchAll(/^\[([^\]\n]+\.(?:md|json))\]/gm)].map((m) => m[1]), effort: body.reasoning_effort || body.reasoningEffort || null });
    // The connector's warm up (lib/warm.mjs) asks for one word: answered at once, like the title step.
    const isWarm = last.includes("Reply with the single word OK");
    const slow = !isCleanup && !isWarm && chat && ((body.tools || []).length > 0 || isQuick);
    // A quick answer (Chat's chat.quick) cites the first note it was given.
    const cite = (seen.at(-1).notes || [])[0];
    const reply = isCleanup ? answer(last) : isWarm ? "OK" : slow ? (isQuick ? `${chat.quickText || "From your notes."}${cite ? `\n\nSources:\n- \`${cite}\`` : ""}` : chat.text) : "Clean up a document";
    const id = `chatcmpl-${seen.length}`;
    const chunk = (delta, finish = null, usage) => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: body.model || "qwen-mock", choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;
    if (!body.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ id, object: "chat.completion", created: 1, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }], usage: { prompt_tokens: Math.ceil(all.length / 4), completion_tokens: Math.ceil(reply.length / 4), total_tokens: 0 } }));
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(chunk({ role: "assistant", content: "" }));
    const end = () => {
      res.write(chunk({}, "stop", { prompt_tokens: Math.ceil(all.length / 4), completion_tokens: Math.ceil(reply.length / 4), total_tokens: Math.ceil((all.length + reply.length) / 4) }));
      res.end("data: [DONE]\n\n");
    };
    if (!slow) {
      for (let i = 0; i < reply.length; i += 40) res.write(chunk({ content: reply.slice(i, i + 40) }));
      return end();
    }
    // A slow local model: the first characters after firstMs, then `size` more every everyMs.
    let i = 0;
    const step = () => {
      if (res.destroyed) return;
      if (i >= reply.length) return end();
      res.write(chunk({ content: reply.slice(i, i + chat.size) }));
      i += chat.size;
      setTimeout(step, chat.everyMs);
    };
    setTimeout(step, chat.firstMs);
  });
});

if (process.argv[1] && process.argv[1].endsWith("mock-model.mjs")) {
  server.listen(0, "127.0.0.1", () => {
    console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/v1` }));
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      let m;
      try { m = JSON.parse(line); } catch { return console.log(JSON.stringify({ error: "bad json" })); }
      if (m.style) { style = m.style; return console.log(JSON.stringify({ ok: true })); }
      if (m.chat) { chat = { firstMs: 300, everyMs: 50, size: 6, text: "Hello from the stand-in model.", ...m.chat }; return console.log(JSON.stringify({ ok: true })); }
      if (m.requests) return console.log(JSON.stringify({ requests: seen }));
      console.log(JSON.stringify({ error: "unknown command" }));
    });
    rl.on("close", () => process.exit(0));
  });
}
