#!/usr/bin/env python3
"""Knowledge base V1 (docs/knowledge.md) in headless Chromium: Settings, Knowledge on the hosted site, paired with the
real agent and the opencode connector on a synthetic workspace and a fake opencode (tests/fixtures/runs-fixture.mjs).

  python tests/knowledge-e2e.py [--shots <folder>]

Products with the For Tandem fields, the Glossary, importing a hand-written repo map, writing it (the hand-written file
kept beside it), Keep it up to date after a save, Checks, and voice.md from Writing. Synthetic data only.
Exit 1 if any check fails.
"""
import functools, http.server, json, os, shutil, subprocess, sys, tempfile, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOSTED = 'http://localhost:8813'
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None

failed = []
def check(name, ok):
    print(('ok    ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


class Static(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


def serve(port):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Static, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()


HAND_MAP = """# Workspace repo map

Agents: use this file to choose repos for a work item.

## Repos

| Folder | What it is (one line) | Stack | Shared? |
|---|---|---|---|
| gateway | The API gateway everything goes through | dotnet | No |

## Products

### Sample Gateway

Also called: SG

| Repo | What lives here for this product | Typical changes |
|---|---|---|
| gateway | Routes | New routes |

- Change order: gateway
- External systems: Payment gateway REST API

## Glossary

| Work item term | Name in code | Product | Where it shows up |
|---|---|---|---|
| Route | `GatewayRoute` | Sample Gateway | `gateway/src/Route.cs` |

## Do not touch

- Generated clients in `gateway/generated/`.
"""


def main():
    serve(8813)
    fx = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'fixtures', 'runs-fixture.mjs')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    info = json.loads(fx.stdout.readline())
    workspace = info['workspace']
    tmp = tempfile.mkdtemp()
    apps, conns, home = (os.path.join(tmp, d) for d in ('apps', 'connectors', 'home'))
    for name in ('settings', 'notes', 'chat'):
        shutil.copytree(os.path.join(ROOT, 'apps', name), os.path.join(apps, name))
    shutil.copytree(os.path.join(ROOT, 'connectors', 'opencode'), os.path.join(conns, 'opencode'))
    os.makedirs(home)
    data = os.path.join(tmp, 'Workshop')
    with open(os.path.join(home, 'config.json'), 'w') as f:
        json.dump({'configVersion': 1, 'port': 4380, 'dataDir': data, 'allowedOrigins': [HOSTED], 'features': {'startAtLogin': False, 'hostedMode': True},
                   'connectors': {'opencode': {'enabled': True, 'config': {'workspace': workspace, 'opencode': {'url': info['opencode'], 'startServer': False}, 'pollSeconds': 20}}}}, f)
    with open(os.path.join(workspace, 'AGENTS.md'), 'w') as f: f.write(HAND_MAP)
    proc = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'e2e-agent.mjs'), '--home', home, '--apps', apps, '--connectors', conns],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    a = json.loads(proc.stdout.readline())
    errors = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context(viewport={'width': 1280, 'height': 900})
            pg = ctx.new_page()
            pg.goto(HOSTED + '/manifest.webmanifest')
            pg.evaluate(f"localStorage.setItem('workshop.agent', JSON.stringify({{url: '{a['url']}', token: '{a['token']}'}}))")
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.goto(HOSTED + '/#/settings/repo-map'); pg.wait_for_timeout(2500)
            if pg.is_visible('#spanelScrim'): pg.click('#spanelScrim'); pg.wait_for_timeout(300)  # the first-run Needs you panel
            sf = next(f for f in pg.frames if '/apps/settings/' in f.url)
            sf.wait_for_selector('#repo-map-card .pc-row', timeout=15000)
            check('Knowledge is one nav item with four tabs', sf.eval_on_selector_all('[data-nav=knowledge] .tab, #nav-knowledge .tab, .tabs [data-page]', 'els => els.map(e => e.dataset.page).filter(p => ["products","glossary","repo-map","checks"].includes(p))') == ['products', 'glossary', 'repo-map', 'checks'])
            check('the hand-written map is seen and not overwritten yet', 'Written by hand' in sf.inner_text('#repo-map-card'))
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'k1-repo-map-hand.png'))

            sf.click('[data-rm-import]'); sf.wait_for_selector('.rm-plan')
            plan = sf.inner_text('.rm-plan')
            check('import previews a new product, a word, a repo description and the other sections', '1 new product (Sample Gateway)' in plan and '1 glossary word' in plan and '1 repo description' in plan and 'other sections' in plan)
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'k2-import-preview.png'))
            sf.click('[data-rm-import-go]'); pg.wait_for_timeout(1500)
            with open(os.path.join(data, 'settings', 'products.json')) as f: prods = json.load(f)
            gw = next((x for x in prods['items'] if x['name'] == 'Sample Gateway'), None)
            check('the product is in Settings with its Tandem fields', gw is not None and gw.get('changeOrder') == ['gateway'] and gw.get('external') == ['Payment gateway REST API'])
            with open(os.path.join(data, 'settings', 'glossary.json')) as f: gl = json.load(f)
            check('the glossary word is in Settings, tied to the product', [(w['term'], w['code'], w.get('productId')) for w in gl['items']] == [('Route', 'GatewayRoute', 'p_sample-gateway')])

            sf.click('[data-rm-write]'); pg.wait_for_timeout(1500)
            with open(os.path.join(workspace, 'AGENTS.md')) as f: written = f.read()
            kept = os.path.join(workspace, 'AGENTS.md.hand-written.md')
            check('Write it now writes the map with the marker; the hand-written one is kept beside it',
                  written.startswith('<!-- Written by Workshop -->') and os.path.exists(kept) and open(kept).read() == HAND_MAP)
            check('the map has the product, the glossary and the kept sections', '### Sample Gateway' in written and '- Change order: gateway' in written
                  and '| Route | `GatewayRoute` | Sample Gateway |' in written and '## Do not touch' in written and '| gateway | The API gateway everything goes through |' in written)
            check('the status says Workshop wrote it', 'Written by Workshop' in sf.inner_text('#repo-map-card'))

            # Products: add one with For Tandem fields; Keep it up to date writes the map again.
            sf.click('#tab-products'); pg.wait_for_timeout(400)
            sf.click('[data-product-new]'); sf.fill('[data-product-form] [name=name]', 'Sample Portal')
            sf.fill('[data-product-form] [name=repos]', 'gateway\nold-repo')
            sf.click('.for-tandem summary')
            sf.fill('[data-product-form] [name=processes]', 'Place an order\nIssue a refund')
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'k3-product-form.png'), full_page=True)
            sf.click('[data-product-form] .btn.primary'); pg.wait_for_timeout(2000)
            with open(os.path.join(workspace, 'AGENTS.md')) as f: written = f.read()
            check('a product save keeps the repo map up to date', '### Sample Portal' in written and '- Business processes: Place an order, Issue a refund' in written and '| gateway | The API gateway everything goes through | dotnet | Yes |' in written)
            check('the product card says what is set for Tandem', 'For Tandem' in sf.inner_text('#products') and '2 processes' in sf.inner_text('#products'))
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'k4-products.png'), full_page=True)

            # Glossary: add a word with Enter, save.
            sf.click('#tab-glossary'); pg.wait_for_timeout(300)
            sf.click('[data-gl-add]')
            row = sf.locator('[data-gl-row]').last
            row.locator('[name=term]').fill('Member'); row.locator('[name=code]').fill('Subscriber')
            sf.click('[data-gl-form] .btn.primary'); pg.wait_for_timeout(1500)
            with open(os.path.join(data, 'settings', 'glossary.json')) as f: gl = json.load(f)
            check('Glossary saves words in place', sorted(w['term'] for w in gl['items']) == ['Member', 'Route'])
            with open(os.path.join(workspace, 'AGENTS.md')) as f: written = f.read()
            check('a glossary save keeps the repo map up to date', '| Member | `Subscriber` |' in written)
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'k5-glossary.png'))

            # Checks: a product repo that is not in the workspace.
            sf.click('#tab-checks'); pg.wait_for_timeout(300)
            sf.click('[data-ck-again]'); pg.wait_for_timeout(1200)
            ck = sf.inner_text('#checks-card')
            check('Checks lists a product repo missing from the workspace, with where to fix it', 'Sample Portal lists old-repo, which is not in the workspace.' in ck and sf.locator('.ck-list [data-goto-page=products]').count() > 0)
            if SHOTS: pg.screenshot(path=os.path.join(SHOTS, 'k6-checks.png'))

            # Writing voice: saving the style guide writes voice.md for Tandem.
            pg.goto(HOSTED + '/#/settings/writing'); pg.wait_for_timeout(1500)
            sf = next(f for f in pg.frames if '/apps/settings/' in f.url)
            sf.wait_for_selector('[data-style]', timeout=10000)
            sf.fill('[data-style]', 'Short sentences. Plain words.')
            sf.click('[data-save-style]'); pg.wait_for_timeout(1200)
            vm = os.path.join(data, 'settings', 'voice.md')
            check('saving Writing writes settings/voice.md for Tandem', os.path.exists(vm) and 'Short sentences. Plain words.' in open(vm).read())

            # Notes makes the team handbook once.
            pg.goto(HOSTED + '/#/notes'); pg.wait_for_timeout(3000)
            check('Notes makes the team handbook', os.path.exists(os.path.join(data, 'notes', 'team', 'handbook.md')))
            b.close()
    finally:
        proc.stdin.close(); proc.terminate(); fx.stdin.close(); fx.terminate()
        shutil.rmtree(tmp, ignore_errors=True)
    check('no page errors', not errors)
    if errors: print('\n'.join(errors))
    if failed:
        print(f'\n{len(failed)} failed'); sys.exit(1)
    print('\nall knowledge checks passed')


main()
