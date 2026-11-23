// lib/chat-live.mjs (1.38.0): opencode's stream for a chat a page is looking at, as chat.text and chat.changed events.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHANGED_MS, MAX_TEXT, TEXT_MS, WATCH_MS, chatChanged, chatText, isWatched, resetChatLive, watchChat } from "../lib/chat-live.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("only chats a page read in the last two minutes are passed on", () => {
  resetChatLive();
  const sent = [];
  const send = (e, p) => sent.push([e, p]);
  assert.equal(chatText("ses_a", "prt_1", "hi", { send }), false);
  watchChat("ses_a", 1000);
  assert.equal(isWatched("ses_a", 1000 + WATCH_MS), true);
  assert.equal(isWatched("ses_a", 1001 + WATCH_MS), false);
  resetChatLive();
});

test("text is sent at most every 80 ms, the newest text per part, then one chat.changed", async () => {
  resetChatLive();
  const sent = [];
  const send = (e, p) => sent.push([e, p]);
  watchChat("ses_a");
  chatText("ses_a", "prt_1", "Hel", { send });
  chatText("ses_a", "prt_1", "Hello", { send });
  chatChanged("ses_a", { send });
  assert.equal(sent.length, 0, "nothing at once");
  await wait(TEXT_MS + 30);
  assert.deepEqual(sent, [["chat.text", { session: "ses_a", part: "prt_1", text: "Hello" }], ["chat.changed", { session: "ses_a" }]]);
  chatChanged("ses_a", { send });
  await wait(CHANGED_MS + 30);
  assert.deepEqual(sent.at(-1), ["chat.changed", { session: "ses_a" }]);
  resetChatLive();
});

test("long text is cut so an event stays small", async () => {
  resetChatLive();
  const sent = [];
  watchChat("ses_b");
  chatText("ses_b", "prt_2", "x".repeat(MAX_TEXT + 500), { send: (e, p) => sent.push(p) });
  await wait(TEXT_MS + 30);
  assert.equal(sent[0].text.length, MAX_TEXT);
  resetChatLive();
});
