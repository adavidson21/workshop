# Writing voice

Rewrite a draft in your own voice for a given audience (Leadership, Business teams, or your own), and learn from what you send. Local only: no outside writing service. The AI steps run through opencode with the provider you already use, so they follow Approved AI providers like everything else. Settings, Writing holds your samples, style guide and rules; Rewrite a draft is in Chat (since Chat 1.1.0 and Settings 6.4.0).

Version: the `settings.writing` collection is version 1. The code is `shared/voice.js` (pure, shared; `apps/settings/js/voice-model.js` re-exports it), Settings' `voice-page.js` (the pages) and Chat's `js/rewrite.js` (Rewrite a draft); the connector side is `connectors/opencode/lib/voice.mjs`.

## Use

1. **Once:** Settings, Writing, Voice. Under Samples, paste 5 to 10 messages you sent that landed well, per audience (a line with `---` between messages). Click **Build my style guide**, read it, fix anything wrong, and save.
2. **Each time:** Chat, **Rewrite a draft** (in the sidebar under New chat, or `#/chat/rewrite`). Paste your draft as it came out, pick the audience (and a reader from People, if it matters), and click **Rewrite**. Copy the result.
3. **Then one click:** **Sent as is**, **I changed it** (paste what you sent), or **Didn't use** (an optional reason).
4. **Now and then:** Writing, Rules. Approve or reject what it proposed, pin what should never change.

## Data

Settings keeps one collection named `writing` (`settings.writing`, `<dataDir>/settings/writing.json`) in the usual envelope ([data-format.md](data-format.md)). Everything is in `meta`; `items` stays empty.

| Field | Meaning |
| --- | --- |
| `audiences` | `[{id, name, cap, rules[]}]`. `cap` is the most sentences. |
| `shared` | Rules for every audience, one string each. |
| `banned` | Words the check flags. |
| `style` | The style guide, Markdown, editable. |
| `samples` | `{<audience id>: [{id, text, from: "you" or "approved", at}]}`. At most 20 per audience: over that, the oldest `approved` (a draft you sent) goes first. Samples you pasted are never dropped automatically. |
| `rules` | Learned rules: `{id, text, status, audience, reader, from, seen, at}`. `status` is `proposed`, `active`, `pinned` or `rejected`. An empty `audience` or `reader` means any. |
| `applied` | Ids of Chat feedback items already applied (the newest 300). |
| `updatedAt` | Stamped on each save. |

Chat may write only its own data, so your answers to a rewrite are items in Chat's `writing-feedback` collection (`chat.writing-feedback`, newest 200): `{id, kind: "feedback", verdict, audience, reader, draft, final, reason, learn, updatedAt}`, where `learn` is `{kind: "new", text}`, `{kind: "same", ruleId}` or null. Settings applies items not in `applied` when it loads and whenever the collection changes (`applyPending`), and Chat applies the same pending items to what it reads, so a reason counts on your next rewrite even before Settings opens.

## How it learns

- **Sent as is:** the draft becomes a sample (`approved`).
- **I changed it:** what you sent becomes a sample, then a second AI step compares the two and replies `RULE: <text>` (a new **proposed** rule), `SAME: <n>` (the same kind of change as proposed rule n, which then becomes **active**) or `NONE`.
- **Didn't use, with a reason:** the reason becomes an **active** rule for that audience (and that reader, if one was picked).
- **Didn't use, no reason:** nothing is learned.
- Only **active** and **pinned** rules go into a rewrite. A **rejected** rule is kept so it is not proposed again.

## The check

After each rewrite, plain code (not AI) checks for em dashes, banned words, and more sentences than the audience's cap. Anything found shows as a warning under the draft. The text is never changed for you.

## AI steps

The page builds the whole prompt (style guide, the newest 6 samples for the audience, active and pinned rules, shared rules, banned words, the reader's name and role, the draft) and calls the opencode connector:

- `voice.run` (write, needs `confirm`): `{kind: "style" | "rewrite" | "learn", prompt}` starts a new opencode session with opencode's read-only `plan` agent (else Tandem's read-only `chat`, else opencode's default) and returns `{session}`.
- `voice.result`: `{session}` returns `{state: "running"}`, `{state: "done", text}` (the agent's last reply) or `{state: "failed", error}`.

Both run whenever the opencode connector is on, like the hub and chats (since connector 1.17.0; turn the connector off to stop them). The draft and samples are fenced in the prompt and called text, not instructions; the agent is read only, so a draft cannot make it change files or run commands. Nothing is posted or sent by Workshop.
