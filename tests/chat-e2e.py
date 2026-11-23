#!/usr/bin/env python3
"""Chat end to end in headless Chromium, on a local-model setup: real opencode with an Ollama-style provider pointed at
a stand-in model server (tests/fixtures/mock-model.mjs) that streams slowly, like a small local model, the real
Workshop agent with the opencode connector, and the hosted site.

  python tests/chat-e2e.py [--quick-agent] [--shots <folder>] [--chromium <path>]

Measures what makes Chat feel slow next to opencode's own terminal: how long after the model's first characters they
show in Chat, whether the answer grows as it streams (not in jumps), and how soon after the model's last character the
chat is done. Checks a selection in the thread survives the stream. Synthetic data only. Needs `opencode` on PATH
(npm i -g opencode-ai) and npm reachable once (opencode installs its OpenAI-compatible provider); prints "skipped"
and exits 0 without opencode. Exit 1 if any check fails.
"""
import functools, http.server, json, os, shutil, socket, subprocess, sys, tempfile, threading, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOSTED = 'http://localhost:8815'
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
AGENT = '--quick-agent' in sys.argv  # put tests/fixtures/quick-agent.md (a copy of Tandem's quick agent) in the workspace
CHROMIUM = sys.argv[sys.argv.index('--chromium') + 1] if '--chromium' in sys.argv else None

failed = []
def check(name, ok, detail=''):
    print(('ok    ' if ok else 'FAIL  ') + name + (f'  ({detail})' if detail and not ok else ''))
    if not ok: failed.append(name)


class Static(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


def serve(port):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Static, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def wait_for(fn, timeout=180, step=0.5):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v: return v
        time.sleep(step)
    return None


# About 600 characters, streamed 6 every 50 ms: 5 seconds of writing, like a small local model.
QUICK = 'You release on Thursdays, after the 2pm check.'
ANSWER = ('The build failed because the test runner could not find its config. ' * 9).strip()
FIRST_MS, EVERY_MS, SIZE = 1500, 50, 6
LAST_ANSWER_TEXT = """() => { const turns = [...document.querySelectorAll('.turns > .turn')]; let i = turns.length - 1;
  while (i >= 0 && !turns[i].classList.contains('you')) i--;
  return turns.slice(i + 1).map(t => [...t.querySelectorAll('.md')].map(d => d.textContent).join(' ')).join(' '); }"""
# The length of the answer to your last message (its text, not the tool lines or the meta line).
LAST_ANSWER = """() => { const turns = [...document.querySelectorAll('.turns > .turn')]; let i = turns.length - 1;
  while (i >= 0 && !turns[i].classList.contains('you')) i--;
  return turns.slice(i + 1).filter(t => !t.classList.contains('writing')).reduce((n, t) => n + [...t.querySelectorAll('.md')].reduce((m, d) => m + d.textContent.length, 0), 0); }"""


def main():
    if not shutil.which('opencode'):
        print('skipped: opencode is not on PATH (npm i -g opencode-ai)'); return 0
    serve(8815)
    tmp = tempfile.mkdtemp()
    model = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'fixtures', 'mock-model.mjs')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    murl = json.loads(model.stdout.readline())['url']
    def to_model(cmd):
        model.stdin.write(json.dumps(cmd) + '\n'); model.stdin.flush(); return json.loads(model.stdout.readline())
    to_model({'chat': {'firstMs': FIRST_MS, 'everyMs': EVERY_MS, 'size': SIZE, 'text': ANSWER, 'quickText': QUICK}})

    workspace, ochome = os.path.join(tmp, 'work'), os.path.join(tmp, 'ochome')
    os.makedirs(workspace); os.makedirs(ochome)
    with open(os.path.join(workspace, 'opencode.json'), 'w') as f:
        json.dump({'$schema': 'https://opencode.ai/config.json', 'model': 'ollama/qwen-mock', 'small_model': 'ollama/qwen-mock', 'autoupdate': False, 'share': 'disabled',
                   'provider': {'ollama': {'npm': '@ai-sdk/openai-compatible', 'name': 'Ollama (stand-in)', 'options': {'baseURL': murl},
                                           'models': {'qwen-mock': {'name': 'Qwen stand-in', 'reasoning': True, 'limit': {'context': 32768, 'output': 8192},
                                                                     'variants': {'low': {'reasoningEffort': 'low'}, 'high': {'reasoningEffort': 'high'}}}}}}}, f)
    with open(os.path.join(workspace, 'AGENTS.md'), 'w') as f: f.write('# Workspace repo map\n\nNo repos.\n')
    if AGENT:
        os.makedirs(os.path.join(workspace, '.opencode', 'agent'))
        shutil.copy(os.path.join(ROOT, 'tests', 'fixtures', 'quick-agent.md'), os.path.join(workspace, '.opencode', 'agent', 'quick.md'))
    ocport = free_port()
    env = {**os.environ, 'HOME': ochome, 'XDG_DATA_HOME': os.path.join(ochome, 'data'), 'XDG_CONFIG_HOME': os.path.join(ochome, 'config'), 'XDG_CACHE_HOME': os.path.join(ochome, 'cache')}
    oc = subprocess.Popen(['opencode', 'serve', '--port', str(ocport), '--hostname', '127.0.0.1'], cwd=workspace, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ocurl = f'http://127.0.0.1:{ocport}'
    def oc_up():
        try:
            import urllib.request; urllib.request.urlopen(ocurl + '/config', timeout=2); return True
        except Exception: return False
    check('opencode serves the workspace', bool(wait_for(oc_up, 60)))

    apps, conns, home = (os.path.join(tmp, d) for d in ('apps', 'connectors', 'home'))
    for name in ('settings', 'chat', 'home'):
        shutil.copytree(os.path.join(ROOT, 'apps', name), os.path.join(apps, name))
    shutil.copytree(os.path.join(ROOT, 'connectors', 'opencode'), os.path.join(conns, 'opencode'))
    os.makedirs(home)
    data = os.path.join(tmp, 'Workshop')
    os.makedirs(os.path.join(data, 'notes', 'team'))
    os.makedirs(os.path.join(data, 'notes', 'meetings'))
    with open(os.path.join(data, 'notes', 'team', 'handbook.md'), 'w') as f:
        f.write('# Team handbook\n\n## Releases\n\nWe release on Thursdays after the 2pm check. Hotfixes can go any day.\n\n## Sprints\n\nTwo weeks, starting Monday.\n')
    with open(os.path.join(data, 'notes', 'meetings', 'lunch.md'), 'w') as f:
        f.write('# Lunch\n\nTacos on Friday.\n')
    with open(os.path.join(home, 'config.json'), 'w') as f:
        json.dump({'configVersion': 1, 'port': 4381, 'dataDir': data, 'allowedOrigins': [HOSTED], 'features': {'startAtLogin': False, 'hostedMode': True},
                   'connectors': {'opencode': {'enabled': True, 'config': {'workspace': workspace, 'localModel': 'on', 'opencode': {'url': ocurl, 'startServer': False}, 'pollSeconds': 20}}}}, f)
    proc = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'e2e-agent.mjs'), '--home', home, '--apps', apps, '--connectors', conns],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    a = json.loads(proc.stdout.readline())
    errors = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(**({'executable_path': CHROMIUM} if CHROMIUM else {}))
            pg = b.new_context(viewport={'width': 1280, 'height': 900}).new_page()
            pg.goto(HOSTED + '/manifest.webmanifest')
            pg.evaluate(f"localStorage.setItem('workshop.agent', JSON.stringify({{url: '{a['url']}', token: '{a['token']}'}}))")
            pg.evaluate("localStorage.setItem('chat.pick', JSON.stringify({agent: 'build', model: ''}))")
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.goto(HOSTED + '/#/chat'); pg.wait_for_timeout(2500)
            if pg.is_visible('#spanelScrim'): pg.click('#spanelScrim'); pg.wait_for_timeout(300)
            cf = wait_for(lambda: next((f for f in pg.frames if '/apps/chat/' in f.url), None), 20)
            box = 'textarea[data-keep^="chat:"]'
            cf.wait_for_selector(box, timeout=30000)
            wait_for(lambda: not cf.is_disabled(box), 30)

            def ask(text):
                """Send a message and sample the last answer's length every 25 ms until the chat is done."""
                cf.fill(box, text)
                t0 = time.time()
                cf.press(box, 'Enter')
                samples = []
                end = time.time() + 60
                while time.time() < end:
                    n = cf.evaluate(LAST_ANSWER)
                    busy = cf.evaluate("() => !!document.querySelector('[data-chat-stop]')")
                    samples.append((time.time() - t0, n, busy))
                    if n >= len(ANSWER) - 5 and not busy: break
                    time.sleep(0.025)
                return samples

            # 1. A new chat, then a follow up in it (the TUI's usual loop).
            for label in ('first message (new chat)', 'follow up'):
                s = ask('Why did the build fail?' if label.startswith('first') else 'And how do I fix it?')
                first = next((t for t, n, _ in s if n > 0), None)
                full = next((t for t, n, _ in s if n >= len(ANSWER) - 5), None)
                done = next((t for t, n, busy in s if n >= len(ANSWER) - 5 and not busy), None)
                steps = len({n for _, n, _ in s if 0 < n < len(ANSWER) - 5})
                model_first = FIRST_MS / 1000
                model_last = model_first + (len(ANSWER) / SIZE) * EVERY_MS / 1000
                print(f'info  {label}: first text at {first}s (model starts ~{model_first:.1f}s plus opencode), whole answer at {full}s (model ends ~{model_last:.1f}s plus opencode), done at {done}s, {steps} visible steps while streaming')
                check(f'{label}: the answer shows', first is not None and full is not None, s[-3:])
                if first is None or full is None: continue
                check(f'{label}: the answer grows as it streams (at least 20 steps)', steps >= 20, steps)
                check(f'{label}: the chat is done within 1.5s of the whole answer', done is not None and done - full < 1.5, (full, done))

            # 2. A selection in the thread survives the next answer streaming in (Chat used to redraw every node).
            cf.fill(box, 'Thanks')
            cf.press(box, 'Enter')
            pg.wait_for_timeout(2200)
            cf.evaluate("() => { const t = document.querySelector('.turn.tandem .md'); const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }")
            before = cf.evaluate(LAST_ANSWER)
            pg.wait_for_timeout(2500)
            sel = cf.evaluate("() => String(getSelection()).length")
            grew = cf.evaluate(LAST_ANSWER) > before
            check('a selection in the thread survives the next answer streaming in', sel > 100 and grew, (sel, grew))
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'chat.png'))
            idle = lambda: wait_for(lambda: not cf.is_visible('[data-chat-stop]'), 30, 0.1)
            idle()

            # 2b. opencode's TUI on a message and its commands (Chat 4.6.0): reasoning effort, Fork from here, Undo from here, /status.
            check('the model has reasoning efforts, so Chat offers the picker', bool(wait_for(lambda: cf.is_visible('[data-pick="effort"]'), 10)))
            cf.click('[data-pick="effort"]')
            cf.click('[data-pop] .pop-it:has-text("High")')
            n0 = len(to_model({'requests': True})['requests'])
            cf.fill(box, 'Think harder about it'); cf.press(box, 'Enter')
            sent = wait_for(lambda: [r for r in to_model({'requests': True})['requests'][n0:] if r['tools']], 20)
            check('the picked effort goes to the model', bool(sent) and sent[0]['effort'] == 'high', sent)
            idle()
            you0 = cf.evaluate("() => document.querySelectorAll('.turns > .turn.you').length")
            cf.hover('.turns > .turn.tandem >> nth=0')
            cf.click('.turns > .turn.tandem >> nth=0 >> [data-turn-fork]')
            forked = wait_for(lambda: '(copy)' in (cf.text_content('.chat-top h2') or '') and cf.evaluate("() => document.querySelectorAll('.turns > .turn.you').length") == 1, 15)
            check(f'Fork from here on the first answer: a new chat with only that exchange (the first had {you0} messages)', bool(forked), cf.text_content('.chat-top h2'))
            cf.hover('.turns > .turn.you >> nth=0')
            cf.click('.turns > .turn.you >> nth=0 >> [data-turn-undo]')
            undone = wait_for(lambda: cf.is_visible('.divider.undo') and cf.input_value(box) == 'Why did the build fail?', 15)
            check('Undo from here takes the message back and puts its text in the box', bool(undone), cf.input_value(box))
            cf.fill(box, '/status'); cf.press(box, 'Enter')
            check('/status shows opencode\'s MCP servers, language servers and formatters', bool(wait_for(lambda: cf.is_visible('.chat-status') and 'MCP servers' in cf.text_content('.chat-status'), 10)))
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'parity.png'))

            # 3. A question in the Hub (New chat's first agent) gets a quick answer from the notes: one request, no tools.
            n0 = len(to_model({'requests': True})['requests'])
            pg.goto(HOSTED + '/#/chat/hub/' + 'When do we release?'); pg.wait_for_timeout(500)
            t0 = time.time()
            got = wait_for(lambda: QUICK in (cf.evaluate(LAST_ANSWER_TEXT) or ''), 40, 0.05)
            t1 = time.time() - t0
            done = wait_for(lambda: not cf.is_visible('[data-chat-stop]') and cf.is_visible('[data-chat-deeper]'), 20, 0.1)
            check('a hub question gets a quick answer in a chat', bool(got))
            print(f'info  quick answer: whole answer {t1:.1f}s after asking (model starts at {FIRST_MS / 1000:.1f}s)')
            reqs = to_model({'requests': True})['requests'][n0:]
            main = [r for r in reqs if r['quick']]
            check('one model request for it, with no tools', len(main) == 1 and main[0]['tools'] == 0 and len(reqs) == 1, reqs)
            check('the request carries the handbook passage, not the unrelated note', bool(main) and main[0]['notes'][:1] == ['notes/team/handbook.md'] and 'notes/meetings/lunch.md' not in main[0]['notes'], main)
            check('the answer cites the handbook as a Notes source', cf.is_visible('.turn.tandem [data-src-note="team/handbook.md"]'))
            check('Go deeper is offered under a quick answer', bool(done))
            print(f'info  quick request: {main[0]["chars"] if main else 0} characters in all')
            if AGENT: check('with the quick agent the whole request is small (under 3000 characters)', bool(main) and main[0]['chars'] < 3000, main)
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'quick.png'))
            cf.click('[data-chat-deeper]')
            deeper = wait_for(lambda: any(r['tools'] > 0 for r in to_model({'requests': True})['requests'][n0 + 1:]), 30)
            check('Go deeper asks again with an agent that has tools', bool(deeper), to_model({'requests': True})['requests'][n0:])
            moved = wait_for(lambda: cf.evaluate("() => [...document.querySelectorAll('.turns > .turn.you')].length") == 1, 10)
            check('without Tandem\'s quick agent, Go deeper continues in a new chat (that session has tools off)' if not AGENT else 'with the quick agent, Go deeper continues in the same chat', bool(moved) != bool(AGENT))
            reqs = to_model({'requests': True})['requests']
            print(f'info  model requests: {len(reqs)} ({sum(1 for r in reqs if r["tools"])} with tools)')
            check('no page errors', not errors, errors)
            b.close()
    finally:
        for pr in (proc, oc, model):
            try: pr.terminate()
            except Exception: pass
        shutil.rmtree(tmp, ignore_errors=True)
    print(('FAILED: ' + ', '.join(failed)) if failed else 'all checks passed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
