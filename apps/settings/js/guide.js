/* Settings, User guide (Help group): "I need to..." scenarios, each with the best way to do it in Workshop,
   why, and a second way when there is one. Plain words, no setup detail (docs/guide.md has the full tour).
   GUIDE and matches() are pure, so test/guide.test.mjs can import them; mountGuide() draws the page.
   Keep each scenario's steps in step with the apps' READMEs (Slate, Loom's js/flows.js). No em dashes. */

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** App ids to the names people see. */
export const APP_NAMES = { prioritizer: 'Docket', slate: 'Loom', receipts: 'Rapport', runway: 'Runway', notes: 'Folio' };

export const SECTIONS = [
  { id: 'plan', label: 'Planning work' },
  { id: 'build', label: 'Getting code done' },
  { id: 'day', label: 'Your day' }
];

/* A scenario:
     id, section, ask         the situation, in the first person
     app, path                where the best way starts (the Open button: ws.open({app, path}))
     steps                    the best way, in order
     why                      one line on why this way
     also                     [{when, how}] other ways, for a slightly different situation
     needs                    what has to be set up (shown quietly) */
export const GUIDE = [
  {
    id: 'goal-to-stories',
    section: 'plan',
    ask: 'I have a high-level goal and need it broken down into features and user stories.',
    app: 'slate',
    steps: [
      'In Loom, click <b>New idea</b> and write the goal in a sentence or two.',
      'Click <b>Shape it</b>. An agent asks you a few questions at a time, each with a recommended answer. Pick one, write your own, or click <b>Use the recommendations</b>.',
      'When the brief is ready, read it and click <b>Send to Define</b>. Tandem writes the epic, its features and light user stories.',
      'Approve the stories. Tandem puts them in build order. Read that, then click <b>Approve and publish</b>. You see every ADO item before anything is created.'
    ],
    why: 'The interview finds the gaps before any stories exist, and the work stays on one card from idea to released.',
    also: [
      { when: 'You already know what you want and want it fast', how: 'Loom, <b>Start work</b>, <b>Plan an epic</b>. One line in, at most 3 questions, then stories and a build order for you to approve. It ends with ADO items, an ADO import file, or local items.' }
    ],
    needs: 'Tandem (Settings, Agents). Azure DevOps only to publish.'
  },
  {
    id: 'simple-ask',
    section: 'build',
    ask: 'I have a simple, straightforward ask. I want an item made for it and the code done, without the whole process.',
    app: 'slate',
    steps: [
      'In Loom, click <b>New request</b> and describe it.',
      'Open <b>More</b> and pick <b>Define now</b>. This skips triage and the interview. Tandem writes one story with acceptance criteria.',
      'Read it, then open <b>More</b> and pick <b>Approve, publish and build it myself</b>. One click makes the ADO item and starts Tandem building.',
      'Follow it in Loom. Anything waiting on you shows in its <b>Inbox</b>. At the end you read the diff, approve and push, then create the PR.'
    ],
    why: 'You skip triage, the interview and delegation, and the PR still has an ADO item to link to.',
    also: [
      { when: 'You do not need an ADO item at all', how: 'Loom, <b>Start work</b>, <b>Quick change</b>. Describe it and it runs as a feature or a bug. it gets a card on the board, and you can link an ADO item later from that card.' },
      { when: 'The ADO item already exists', how: 'Loom, <b>Start work</b>, <b>Build a feature</b> (or <b>Fix a bug</b>), and type its number.' }
    ],
    needs: 'Tandem (Settings, Agents). Azure DevOps for the item.'
  },
  {
    id: 'bug',
    section: 'build',
    ask: 'Something is broken and I can reproduce it.',
    app: 'slate',
    steps: [
      'In Loom, click <b>Start work</b> and pick <b>Fix a bug</b>.',
      'Type the ADO item number, or describe the bug.',
      'Tandem finds the root cause and writes it up. Approve it, or send it back with a note.',
      'It writes a failing test, fixes it and reviews the fix. You read the diff and push.'
    ],
    why: 'You agree on the cause before any code changes.',
    also: [],
    needs: 'Tandem (Settings, Agents).'
  },
  {
    id: 'investigate',
    section: 'build',
    ask: 'I do not know enough yet to write it up or estimate it.',
    app: 'slate',
    steps: [
      'In Loom, click <b>Start work</b> and pick <b>Investigate</b>.',
      'Type your question in one line, for example how something works today or what it would take to change it.',
      'Tandem reads the code (it changes nothing) and answers with options and a recommendation.',
      'When you are ready, click <b>Start work from this</b>, or <b>Save as note</b> to keep it in Folio.'
    ],
    why: 'A quick answer before you commit to a story or an estimate.',
    also: [],
    needs: 'Tandem (Settings, Agents).'
  },
  {
    id: 'vague-request',
    section: 'plan',
    ask: 'Someone asked for something and I am not sure what they actually want.',
    app: 'slate',
    steps: [
      'In Loom, click <b>New request</b>, describe it and say who asked.',
      'Click <b>Triage</b>. Tandem sums it up, sizes it and writes questions for the requester.',
      'Click <b>Post on #1234</b> to ask on the ADO item, or <b>Copy questions and wait</b> to send them yourself.',
      'When they answer, click <b>Read replies</b> (or paste the answers), then <b>Save answers and triage again</b>.'
    ],
    why: 'The questions go to the person who knows, and nothing is posted without your confirm.',
    also: [
      { when: 'You are the one who knows the answers', how: 'Click <b>Interview me</b> instead of Triage, and answer the questions yourself.' }
    ],
    needs: 'Tandem (Settings, Agents).'
  },
  {
    id: 'delegate',
    section: 'plan',
    ask: 'Someone on my team should build this, not me.',
    app: 'slate',
    steps: [
      'In Loom, get the card to <b>Who builds it?</b> (or use <b>More</b>, <b>Move to</b>, if it is already clear).',
      'Click <b>Delegate</b> and pick a person. People who own what it touches are listed first.',
      'Leave the follow-up task on. Docket reminds you to check in.',
      'Tick <b>Also assign it to them in Azure DevOps</b> only if you want ADO changed too.'
    ],
    why: 'You keep track of what you handed off without chasing it in ADO.',
    also: [
      { when: 'It is a quick task, not a work item', how: 'Open Capture and start the line with <code>w</code> (waiting on someone). It becomes a Docket follow-up.' }
    ],
    needs: 'People set up (Settings, People & groups).'
  },
  {
    id: 'pr-reviews',
    section: 'build',
    ask: 'I have teammates’ pull requests to review.',
    app: 'slate',
    path: 'reviews',
    steps: [
      'In Loom, open the <b>Reviews</b> tab.',
      'Click <b>Review all</b> for every PR waiting on you, or <b>Review a link</b> for one.',
      'Read each first-pass review: a recommendation, the risk and draft comments.',
      'Copy the comments you agree with into the PR yourself. Nothing is posted for you.'
    ],
    why: 'Tandem does the first read, you make the call.',
    also: [
      { when: 'You want them ready each morning', how: 'Set a nightly review time in Loom’s menu, opencode settings.' }
    ],
    needs: 'Tandem, and Azure DevOps for the list of PRs.'
  },
  {
    id: 'docs',
    section: 'build',
    ask: 'I need documentation or a technical spec written.',
    app: 'slate',
    steps: [
      'In Loom, click <b>Start work</b> and pick <b>Write docs</b> or <b>Technical spec</b>.',
      'Answer its questions: where it lives, who reads it, which flows to show.',
      'A fresh session fact-checks it against the code.',
      'Fix what the check flags, then publish it.'
    ],
    why: 'Docs that match the code, checked by a second pass.',
    also: [],
    needs: 'Tandem (Settings, Agents).'
  },
  {
    id: 'what-next',
    section: 'day',
    ask: 'I do not know what to work on next.',
    app: 'prioritizer',
    path: 'today',
    steps: [
      'Open Docket’s <b>Today</b>. Workshop opens there.',
      'Sort new things in <b>To sort</b>, one key each.',
      'Work from the top of your ranked list.',
      'Check <b>Needs you</b> in the top bar for anything waiting on you in other apps.'
    ],
    why: 'One list for the day, with everything else one click away.',
    also: [],
    needs: ''
  },
  {
    id: 'capture',
    section: 'day',
    ask: 'I need to jot something down before I lose it.',
    app: '',
    steps: [
      'Press <code>Ctrl+.</code> (<code>Cmd+.</code> on a Mac), or click <b>Capture</b> in the top bar, from any app.',
      'Start with a letter: <code>t</code> task, <code>w</code> waiting on someone, <code>n</code> note, <code>r</code> a win for Rapport, <code>p</code> a roadmap idea, <code>?</code> ask Tandem.',
      'Press Enter. It lands in the right app and you keep working.'
    ],
    why: 'Capture first, sort later.',
    also: [],
    needs: ''
  },
  {
    id: 'one-on-one',
    section: 'day',
    ask: 'I have a 1:1 coming up.',
    app: 'receipts',
    path: '1on1s',
    steps: [
      'In Rapport, open the <b>1:1s</b> tab and pick the person.',
      'Read the prep. It gathers what Docket, Loom and Rapport know since your last 1:1.',
      'Take notes during the meeting.',
      'After, send follow-ups to Docket and save wins as receipts.'
    ],
    why: 'You walk in prepared without digging through apps.',
    also: [],
    needs: ''
  },
  {
    id: 'roadmap',
    section: 'plan',
    ask: 'I need to show a roadmap to someone.',
    app: 'runway',
    steps: [
      'In Runway, type an outline or drag items on the timeline.',
      'With Azure DevOps on, import Epics and Features instead of typing them.',
      'Export an image or Markdown to share.'
    ],
    why: 'A shareable picture without building slides.',
    also: [],
    needs: ''
  }
];

const plain = s => String(s || '').replace(/<[^>]+>/g, ' ').toLowerCase();

/** Whether a scenario matches the search box (every word, anywhere in it). */
export function matches(s, query) {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = plain([s.ask, APP_NAMES[s.app], ...s.steps, s.why, ...s.also.flatMap(a => [a.when, a.how])].join(' '));
  return words.every(w => text.includes(w));
}

function scenarioHtml(s) {
  const name = APP_NAMES[s.app];
  return `<details class="gd-item" data-guide="${esc(s.id)}">
    <summary><span class="gd-ask">${esc(s.ask)}</span>${name ? `<span class="gd-app">${esc(name)}</span>` : ''}</summary>
    <div class="gd-body">
      <p class="gd-label">Best way</p>
      <ol class="gd-steps">${s.steps.map(x => `<li>${x}</li>`).join('')}</ol>
      <p class="gd-why">${s.why}</p>
      ${s.also.map(a => `<p class="gd-also"><b>${esc(a.when)}?</b> ${a.how}</p>`).join('')}
      <div class="gd-foot">${name ? `<button type="button" class="btn" data-guide-open="${esc(s.id)}">Open ${esc(name)}</button>` : ''}${s.needs ? `<span class="gd-needs">Needs: ${esc(s.needs)}</span>` : ''}</div>
    </div>
  </details>`;
}

export function mountGuide({ ws, el }) {
  const sec = document.createElement('section');
  sec.className = 'card guide';
  sec.innerHTML = `<p class="sub">Pick what you are trying to do. Each one shows the best way to do it in Workshop, and another way when there is one.</p>
    <label class="sr" for="guideFind">Search the guide</label>
    <input id="guideFind" class="cfg-input gd-find" type="search" placeholder="Search, for example: stories, bug, review" autocomplete="off">
    ${SECTIONS.map(x => `<div class="gd-section" data-section="${x.id}"><h3 class="gd-head">${esc(x.label)}</h3>${GUIDE.filter(s => s.section === x.id).map(scenarioHtml).join('')}</div>`).join('')}
    <p class="gd-none sub" hidden>Nothing matches. Try another word.</p>
    <p class="gd-more sub">The full tour of every app is in the Workshop docs (docs/guide.md).</p>`;
  el.appendChild(sec);

  const find = sec.querySelector('.gd-find');
  find.addEventListener('input', () => {
    const q = find.value;
    let any = false;
    for (const s of GUIDE) {
      const row = sec.querySelector(`[data-guide="${s.id}"]`);
      const on = matches(s, q);
      row.hidden = !on;
      if (q.trim()) row.open = on;
      any = any || on;
    }
    for (const g of sec.querySelectorAll('.gd-section')) g.hidden = !g.querySelector('.gd-item:not([hidden])');
    sec.querySelector('.gd-none').hidden = any;
  });
  sec.addEventListener('click', e => {
    const b = e.target.closest('[data-guide-open]');
    if (!b) return;
    const s = GUIDE.find(x => x.id === b.dataset.guideOpen);
    if (s && s.app) ws.open(s.path ? { app: s.app, path: s.path } : { app: s.app });
  });
}
