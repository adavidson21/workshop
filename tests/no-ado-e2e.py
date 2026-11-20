#!/usr/bin/env python3
"""Workshop with Azure DevOps off says nothing about Azure DevOps (docs/shared.md, With no Azure DevOps).

  pip install playwright && python -m playwright install chromium
  python tests/no-ado-e2e.py            # checks
  NO_ADO_REPORT=1 python tests/no-ado-e2e.py   # also prints every hit with its page

Three setups, each in headless Chromium:
  off       the real agent with the ADO connector installed and switched off, and opencode on (a fake opencode)
  missing   the real agent with no ADO connector at all
  browser   browser mode, no agent
For each, every rail app is opened, then every tab, nav item and sidebar place it shows is clicked once. The visible
text and the title, placeholder and aria-label of visible elements must not say "ADO" or "Azure DevOps". The one
exception is Settings' All connections page, where the Azure DevOps row and its switch stay so it can be turned
back on. Exit 1 if any check fails.
"""
import functools, json, os, re, shutil, subprocess, sys, tempfile
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module
e2e = import_module('e2e')

ROOT = e2e.ROOT
SITE = 'http://localhost:8833'
BROWSER_SITE = 'http://127.0.0.1:8834'
REPORT = bool(os.environ.get('NO_ADO_REPORT'))
WORD = re.compile(r'\bADO\b|[Aa]zure [Dd]ev[Oo]ps')
failed = []


def check(name, ok, detail=''):
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'\n      {detail}' if detail and not ok else ''))
    if not ok: failed.append(name)


# Visible text plus the words a person meets on hover or in an empty field. Skips elements marked as the place
# where ADO is switched back on (data-ado-switch).
SCAN_JS = r"""() => {
  const out = [];
  const vis = el => { const r = el.getBoundingClientRect(); if (!r.width && !r.height) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none'; };
  const skip = el => !!el.closest('[data-ado-switch]');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = n.nodeValue.trim(); if (!t) continue;
    const el = n.parentElement; if (!el || skip(el) || ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(el.tagName)) continue;
    if (el.closest('select') ? !vis(el.closest('select')) : !vis(el)) continue;
    out.push(t);
  }
  for (const el of document.querySelectorAll('[title],[placeholder],[aria-label],[data-tip]')) {
    if (skip(el) || !vis(el)) continue;
    for (const a of ['title', 'placeholder', 'aria-label', 'data-tip']) { const v = el.getAttribute(a); if (v) out.push(v); }
  }
  for (const el of document.querySelectorAll('input[type=text],input:not([type]),textarea')) if (vis(el) && el.value && !skip(el)) out.push(el.value);
  return out;
}"""

# Things to click once on each page: tabs, nav items, sidebar places, segmented controls, disclosures.
CLICKABLE = ('[role=tab], nav a[href^="#"], nav button, .tabs button, .tab, [data-tab], [data-page], [data-view], [data-place], '
             '[data-lens], .seg button, .side a, .sidebar a, .sidebar button, details > summary')


def hits_in(texts):
    return sorted({t[:160] for t in texts if WORD.search(t)})


def frame_of(page, app):
    return next((f for f in page.frames if f'/apps/{app}/' in f.url), None)


def crawl(page, app, label):
    """Opens one app in the hub, scans it, clicks each control once and scans again. Returns {where: [hits]}."""
    found = {}
    page.goto(f'{label}/#/{app}'); page.wait_for_timeout(2500)
    fr = frame_of(page, app)
    if not fr: return {'(did not open)': ['no frame']}
    def scan(where):
        try:
            h = hits_in(fr.evaluate(SCAN_JS))
        except Exception as ex:
            h = []
        for x in h: found.setdefault(where, []).append(x)
        try:
            for x in hits_in(page.evaluate(SCAN_JS)): found.setdefault('(shell) ' + where, []).append(x)
        except Exception: pass
    scan('first view')
    for sel in ('#setBtn', '#adoBtn'):  # Docket's Settings menu and work item sync
        try:
            if fr.locator(sel).count() and fr.locator(sel).is_visible():
                fr.locator(sel).click(timeout=1500); page.wait_for_timeout(500); scan(sel)
                fr.keyboard.press('Escape') if hasattr(fr, 'keyboard') else page.keyboard.press('Escape'); page.wait_for_timeout(300)
        except Exception: pass
    try: n = fr.locator(CLICKABLE).count()
    except Exception: n = 0
    seen = set()
    for i in range(min(n, 60)):
        try:
            el = fr.locator(CLICKABLE).nth(i)
            if not el.is_visible(): continue
            name = (el.inner_text() or el.get_attribute('aria-label') or el.get_attribute('title') or '').strip().split('\n')[0][:40]
            if not name or name in seen: continue
            if re.search(r'delete|remove|reset|start over|sign out|publish|push|approve|sync', name, re.I): continue
            seen.add(name)
            el.click(timeout=1500); page.wait_for_timeout(500)
            fr = frame_of(page, app) or fr
            scan(name)
        except Exception:
            continue
    return found


def run_setup(b, name, site, prep=None):
    ctx = b.new_context(viewport={'width': 1400, 'height': 900})
    if prep: prep(ctx)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    with open(os.path.join(ROOT, 'apps', 'registry.json')) as f:
        apps = [a['manifest']['id'] for a in json.load(f)['apps']]
    total = 0
    for app in apps:
        found = crawl(page, app, site)
        n = sum(len(v) for v in found.values())
        total += n
        detail = '; '.join(f'[{k}] ' + ' | '.join(v[:4]) for k, v in list(found.items())[:6])
        check(f'{name}: {app} says nothing about Azure DevOps', n == 0, detail)
        if REPORT and n:
            for k, v in found.items():
                for x in v: print(f'      {app} [{k}] {x}')
    check(f'{name}: no page threw', not errors, '; '.join(errors[:3]))
    ctx.close()


def switch_checks(b, url, token):
    """Workshop on this computer (Settings, editable): Azure DevOps is not in the nav while off, its All connections row
    opens its switch, and turning it on brings the nav item back (and turning it off hides it again)."""
    ctx = b.new_context(viewport={'width': 1400, 'height': 900})
    p = e2e.local_page(ctx, url, token)
    nav = lambda: p.locator('#nav .nav-item[data-nav="ado"]')
    check('off: Settings has no Azure DevOps nav item', nav().count() == 1 and not nav().is_visible())
    p.locator('#nav .nav-item[data-nav="manager"]').click(); p.wait_for_timeout(1200)
    row = p.locator('.cx-row[data-ado-switch]')
    check('off: All connections lists Azure DevOps, the way back on', row.count() == 1 and 'Azure DevOps' in row.inner_text())
    row.locator('[data-cx-open]').click(); p.wait_for_timeout(500)
    sw = p.locator('.conn[data-connector="ado"] [data-enable]')
    check('off: its Settings button opens the Azure DevOps switch', sw.count() == 1 and sw.is_visible())
    sw.check(); p.wait_for_timeout(2500)
    check('turning it on brings back the Azure DevOps nav item', nav().is_visible())
    sw.uncheck(); p.wait_for_timeout(2500)
    check('turning it off hides it again', not nav().is_visible())
    ctx.close()


def start(tmp, ado):
    """The real agent with every app, the given ADO setup and opencode on a fake opencode."""
    fx = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'fixtures', 'dispatch-fixture.mjs')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    info = json.loads(fx.stdout.readline())
    apps, conns, home = (os.path.join(tmp, d) for d in ('apps', 'connectors', 'home'))
    shutil.copytree(os.path.join(ROOT, 'apps'), apps, ignore=shutil.ignore_patterns('test', '*.md'))
    for c in ('opencode', 'github') + (('ado',) if ado != 'missing' else ()):
        shutil.copytree(os.path.join(ROOT, 'connectors', c), os.path.join(conns, c), ignore=shutil.ignore_patterns('test'))
    os.makedirs(home)
    cfg = {'opencode': {'enabled': True, 'config': {'workspace': info['workspace'], 'opencode': {'url': info['opencode'], 'startServer': False}, 'pollSeconds': 20}}}
    if ado == 'off': cfg['ado'] = {'enabled': False}
    with open(os.path.join(home, 'config.json'), 'w') as f:
        json.dump({'configVersion': 1, 'port': 4381, 'allowedOrigins': [SITE], 'features': {'startAtLogin': False, 'hostedMode': True}, 'connectors': cfg}, f)
    proc = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'e2e-agent.mjs'), '--home', home, '--apps', apps, '--connectors', conns],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    a = json.loads(proc.stdout.readline())
    return fx, proc, a['url'], a['token']


def main():
    srv = e2e.serve(8833, functools.partial(e2e.Static, directory=ROOT))
    srv2 = e2e.serve(8834, functools.partial(e2e.Static, directory=ROOT))
    with sync_playwright() as p:
        b = p.chromium.launch()
        only = os.environ.get('NO_ADO_SETUP')
        for setup in ('off', 'missing'):
            if only and only != setup: continue
            tmp = tempfile.mkdtemp()
            fx, proc, url, token = start(tmp, setup)
            try:
                run_setup(b, setup, SITE, lambda ctx: e2e.pair(ctx, SITE, url, token))
                if setup == 'off': switch_checks(b, url, token)
            finally:
                proc.stdin.close(); proc.wait(timeout=10); fx.stdin.close(); fx.wait(timeout=10)
                shutil.rmtree(tmp, ignore_errors=True)
        if not only or only == 'browser':
            run_setup(b, 'browser', BROWSER_SITE)
        b.close()
    print(f'\n{"All no-ADO checks passed." if not failed else f"{len(failed)} no-ADO check(s) failed."}')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
