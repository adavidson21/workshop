#!/usr/bin/env python3
"""Clean up this document (Notes 4.13.0, connector 1.35.0) end to end in headless Chromium, on a local-model setup:
real opencode with an Ollama-style provider pointed at a stand-in model server (tests/fixtures/mock-model.mjs), the
real Workshop agent with the opencode connector, and the hosted site.

  python tests/cleanup-e2e.py [--shots <folder>] [--chromium <path>]

Says "clean up this document" in the Capture bar on an open note, checks the template Notes picked, runs it, and checks
the cleaned copy and that the original is unchanged. Then "... and overwrite it" from the hub with a sloppy model
reply (no end markers, a code fence), which must still parse and replace the note, keeping the old text in History.
Then a note no template fits, which must default to its own shape. Synthetic data only. Needs `opencode` on PATH
(npm i -g opencode-ai) and npm reachable once (opencode installs its OpenAI-compatible provider); prints "skipped"
and exits 0 without opencode. Exit 1 if any check fails.
"""
import functools, http.server, json, os, shutil, socket, subprocess, sys, tempfile, threading, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOSTED = 'http://localhost:8814'
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
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


ROUGH = """# platform sync

who: jo, sam, priya
agenda: release train, on call
Decisions: ship friday
action items:
- jo to fix the flaky test
- [ ] sam writes the release note
"""
ESSAY = """# why we write things down

writing helps teams remember. it makes decisions easier to revisit and lets new people catch up without a meeting.
"""


def main():
    if not shutil.which('opencode'):
        print('skipped: opencode is not on PATH (npm i -g opencode-ai)'); return 0
    serve(8814)
    tmp = tempfile.mkdtemp()
    model = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'fixtures', 'mock-model.mjs')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    murl = json.loads(model.stdout.readline())['url']
    def to_model(cmd):
        model.stdin.write(json.dumps(cmd) + '\n'); model.stdin.flush(); return json.loads(model.stdout.readline())

    # A workspace with an Ollama-style provider, as docs/local-models.md says to set it up.
    workspace, ochome = os.path.join(tmp, 'work'), os.path.join(tmp, 'ochome')
    os.makedirs(workspace); os.makedirs(ochome)
    with open(os.path.join(workspace, 'opencode.json'), 'w') as f:
        json.dump({'$schema': 'https://opencode.ai/config.json', 'model': 'ollama/qwen-mock', 'small_model': 'ollama/qwen-mock', 'autoupdate': False, 'share': 'disabled',
                   'provider': {'ollama': {'npm': '@ai-sdk/openai-compatible', 'name': 'Ollama (stand-in)', 'options': {'baseURL': murl},
                                           'models': {'qwen-mock': {'name': 'Qwen stand-in', 'limit': {'context': 32768, 'output': 8192}}}}}}, f)
    with open(os.path.join(workspace, 'AGENTS.md'), 'w') as f: f.write('# Workspace repo map\n\nNo repos.\n')
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
    for name in ('settings', 'notes', 'chat', 'home'):
        shutil.copytree(os.path.join(ROOT, 'apps', name), os.path.join(apps, name))
    shutil.copytree(os.path.join(ROOT, 'connectors', 'opencode'), os.path.join(conns, 'opencode'))
    os.makedirs(home)
    data = os.path.join(tmp, 'Workshop')
    folio = os.path.join(data, 'notes')
    os.makedirs(os.path.join(folio, 'meetings')); os.makedirs(os.path.join(folio, 'writing'))
    with open(os.path.join(folio, 'meetings', 'platform-sync.md'), 'w') as f: f.write(ROUGH)
    with open(os.path.join(folio, 'writing', 'why-we-write.md'), 'w') as f: f.write(ESSAY)
    with open(os.path.join(home, 'config.json'), 'w') as f:
        json.dump({'configVersion': 1, 'port': 4380, 'dataDir': data, 'allowedOrigins': [HOSTED], 'features': {'startAtLogin': False, 'hostedMode': True},
                   'connectors': {'opencode': {'enabled': True, 'config': {'workspace': workspace, 'localModel': 'on', 'opencode': {'url': ocurl, 'startServer': False}, 'pollSeconds': 20}}}}, f)
    proc = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'e2e-agent.mjs'), '--home', home, '--apps', apps, '--connectors', conns],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    a = json.loads(proc.stdout.readline())
    errors = []
    sync = os.path.join(folio, 'meetings', 'platform-sync.md')
    copy = os.path.join(folio, 'meetings', 'platform-sync-cleaned.md')
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(**({'executable_path': CHROMIUM} if CHROMIUM else {}))
            pg = b.new_context(viewport={'width': 1280, 'height': 900}).new_page()
            pg.goto(HOSTED + '/manifest.webmanifest')
            pg.evaluate(f"localStorage.setItem('workshop.agent', JSON.stringify({{url: '{a['url']}', token: '{a['token']}'}}))")
            pg.on('pageerror', lambda e: errors.append(str(e)))

            def folio_frame():
                return next((f for f in pg.frames if '/apps/notes/' in f.url), None)
            def dismiss():
                if pg.is_visible('#spanelScrim'): pg.click('#spanelScrim'); pg.wait_for_timeout(300)
            def capture(text):
                dismiss()
                pg.click('#capBtn'); pg.wait_for_selector('.capbar .cap-in', timeout=15000)
                pg.fill('.capbar .cap-in', text); pg.wait_for_timeout(300)
                pg.keyboard.press('Enter')

            pg.goto(HOSTED + '/#/notes/meetings/platform-sync.md'); pg.wait_for_timeout(3000); dismiss()
            nf = wait_for(folio_frame, 20)
            nf.wait_for_selector('.side-head', state='attached', timeout=20000)
            wait_for(lambda: nf.is_visible('[data-act=menu]'), 20)

            # 1. "clean up this document" in the Capture bar, on the open note.
            capture('clean up this document')
            nf.wait_for_selector('dialog form.dlg input[name=tpl]', timeout=20000)
            picked = nf.eval_on_selector('dialog input[name=tpl]:checked', 'e => e.value')
            check('Capture opens Clean up on the open note, with the meeting template picked', picked == 'templates/meeting.md', picked)
            check('the dialog says it fits best and keeps the original by default',
                  'fits best' in nf.inner_text('dialog') and not nf.is_checked('dialog input[name=replace]'))
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'c1-dialog.png'))
            t0 = time.time()
            nf.click('dialog button[value=ok]')
            saw_bar = wait_for(lambda: nf.is_visible('.bar:has-text("Cleaning up")'), 20, 0.1)
            check('a progress bar shows while it runs', bool(saw_bar))
            got = wait_for(lambda: os.path.exists(copy) and open(copy).read(), 240, 0.1)
            print(f'info  click to saved copy: {time.time() - t0:.1f}s with the stand-in model (no real inference)')
            check('the cleaned copy is saved next to the original', bool(got))
            text = got or ''
            check('the copy links the original and has the feedback under the title',
                  text.startswith('# Platform sync\n\n> [!TIP] Cleanup feedback') and '[[meetings/platform-sync]]' in text and '> - Add the date of the meeting.' in text, text[:300])
            heads = [l[3:] for l in text.splitlines() if l.startswith('## ')]
            check('the copy has the template sections in order', heads == ['Attendees', 'Notes', 'Decisions', 'Action items'], heads)
            check('the original is unchanged', open(sync).read() == ROUGH)
            wait_for(lambda: 'platform-sync-cleaned.md' in (nf.inner_text('.crumbs') if nf.is_visible('.crumbs') else ''), 15)
            check('Notes opens the cleaned copy', 'platform-sync-cleaned.md' in nf.inner_text('.crumbs'))
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'c2-copy.png'))

            reqs = to_model({'requests': True})['requests']
            big = max([r['chars'] for r in reqs if r['hasInput']] or [0])
            check('one model call for the clean up, and no other model call', sum(1 for r in reqs if r['hasInput']) == 1 and len(reqs) == 1, reqs)
            check('no tool definitions are sent with it', all(r['tools'] == 0 for r in reqs if r['hasInput']), reqs)
            print(f'info  whole prompt opencode sent for the clean up: {big} characters (about {big // 4} tokens)')

            # 2. "... and overwrite it" from the hub, with a sloppy reply.
            to_model({'style': 'sloppy'})
            # The address still says platform-sync.md (Notes opened the copy itself), so go elsewhere first.
            pg.goto(HOSTED + '/#/notes/writing/why-we-write.md'); pg.wait_for_timeout(1500)
            pg.goto(HOSTED + '/#/notes/meetings/platform-sync.md'); pg.wait_for_timeout(2500); dismiss()
            nf = wait_for(folio_frame, 20); nf.wait_for_selector('.side-head', state='attached', timeout=20000); pg.wait_for_timeout(1500)
            check('the original is the open note again', 'platform-sync.md' in nf.inner_text('.crumbs') and 'cleaned' not in nf.inner_text('.crumbs'), nf.inner_text('.crumbs'))
            pg.goto(HOSTED + '/#/chat/hub/' + 'clean up this document and overwrite it'); pg.wait_for_timeout(1500)
            nf = wait_for(folio_frame, 20)
            nf.wait_for_selector('dialog form.dlg input[name=tpl]', timeout=20000)
            check('the hub opens Clean up with Replace checked for "overwrite it"', nf.is_checked('dialog input[name=replace]'))
            check('on the note that was open', 'meetings/platform-sync.md' in nf.inner_text('dialog'), nf.inner_text('dialog')[:200])
            nf.click('dialog button[value=ok]')
            got = wait_for(lambda: (lambda t: t if t != ROUGH else None)(open(sync).read()), 240)
            text = got or ''
            check('a sloppy reply (no end markers, a code fence) still replaces the note', text.startswith('# Platform sync\n\n> [!TIP] Cleanup feedback') and '```' not in text, text[:200])
            check('replacing says the old version is in History, with no cleaned-from', 'in History' in text and 'cleaned-from' not in text)
            hist = os.path.join(folio, 'history')
            olds = [os.path.join(r, n) for r, _, ns in os.walk(hist) for n in ns] if os.path.isdir(hist) else []
            check('the text it replaced is in History', any(open(x).read() == ROUGH for x in olds), olds)

            # 3. A note no template fits defaults to its own shape.
            pg.goto(HOSTED + '/#/notes/writing/why-we-write.md'); pg.wait_for_timeout(2500); dismiss()
            nf = wait_for(folio_frame, 20); nf.wait_for_selector('.side-head', state='attached', timeout=20000); pg.wait_for_timeout(1500)
            capture('tidy up this note')
            nf.wait_for_selector('dialog form.dlg input[name=tpl]', timeout=20000)
            check('a note no template fits defaults to Keep its own shape', nf.eval_on_selector('dialog input[name=tpl]:checked', 'e => e.value') == '')
            check('and the dialog says no template is a clear fit', 'No template is a clear fit' in nf.inner_text('dialog'))
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'c3-own-shape.png'))
            nf.click('dialog button[value=cancel]')
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
