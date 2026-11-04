"""Work mode in headless Chromium (docs/run-modes.md, Work mode).

Builds the pinned copy with `workshop pin` into a temporary Workshop home (with Docket from .remote/prioritizer
when that checkout is there), starts the real agent with work mode on, signs a browser in, and checks:

  - the hub opens from 127.0.0.1 in local mode, with Home, Docket, Dispatch, Rapport and Settings on the rail
  - Settings says work mode is on and names the pinned build
  - Docket opens inside the hub and saves its board in the data folder (when Docket is included)
  - no request goes anywhere but 127.0.0.1
  - an allowed hosted site is still refused

Needs: pip install playwright && python -m playwright install chromium
Run:   python tests/workmode-e2e.py
"""
import json, os, shutil, subprocess, sys, tempfile, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCKET = os.path.join(ROOT, '.remote', 'prioritizer')
HOSTED = 'https://workshop.example.org'
failures = 0


def check(cond, name):
    global failures
    print(('PASS  ' if cond else 'FAIL  ') + name)
    if not cond:
        failures += 1


def main():
    tmp = tempfile.mkdtemp(prefix='workshop-workmode-e2e-')
    home = os.path.join(tmp, 'home')
    data = os.path.join(tmp, 'Workshop')
    os.makedirs(home)
    with open(os.path.join(home, 'config.json'), 'w') as f:
        json.dump({'configVersion': 1, 'port': 4390, 'dataDir': data, 'allowedOrigins': [HOSTED],
                   'features': {'startAtLogin': False, 'hostedMode': True, 'workMode': True}, 'connectors': {}}, f)
    env = {**os.environ, 'WORKSHOP_HOME': home}
    with_docket = os.path.exists(os.path.join(DOCKET, 'app.json'))
    pin = subprocess.run(['node', os.path.join(ROOT, 'workshop.mjs'), 'pin'] + (['--docket', DOCKET] if with_docket else ['--no-docket']),
                         env=env, capture_output=True, text=True)
    check(pin.returncode == 0, 'workshop pin builds the pinned copy')
    if pin.returncode != 0:
        print(pin.stdout, pin.stderr)
        return
    proc = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'e2e-agent.mjs'), '--home', home, '--data-dir', data],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        info = json.loads(proc.stdout.readline())
        url, token = info['url'], info['token']

        # An allowed hosted site is refused in work mode.
        req = urllib.request.Request(url + '/api/health', headers={'Origin': HOSTED})
        try:
            urllib.request.urlopen(req)
            check(False, 'an allowed hosted origin is refused in work mode')
        except urllib.error.HTTPError as e:
            check(e.code == 403, 'an allowed hosted origin is refused in work mode')

        with sync_playwright() as p:
            browser = p.chromium.launch()
            pg = browser.new_page()
            foreign = []
            pg.on('request', lambda r: foreign.append(r.url) if not r.url.startswith(url) and not r.url.startswith('data:') else None)
            pg.goto(f'{url}/?token={token}')
            pg.wait_for_selector('#rail', timeout=15000)
            pg.wait_for_function("() => document.documentElement.dataset.mode === 'local'", timeout=15000)
            check(pg.url.rstrip('/') == url or pg.url.startswith(url + '/#') or pg.url == url + '/', 'signing in lands on the hub, served by this computer')
            rail = pg.inner_text('#rail')
            for name in ['Dispatch', 'Rapport', 'Settings'] + (['Docket'] if with_docket else []):
                check(name in rail or pg.locator(f'#rail [title*="{name}"], #rail [aria-label*="{name}"]').count() > 0, f'{name} is on the rail')

            pg.goto(f'{url}/#/settings')
            frame = None
            for _ in range(50):
                frame = next((f for f in pg.frames if '/apps/settings/' in f.url), None)
                if frame:
                    try:
                        frame.wait_for_selector('text=Work mode is on', timeout=300)
                        break
                    except Exception:
                        pass
                pg.wait_for_timeout(200)
            text = frame.inner_text('body') if frame else ''
            check('Work mode is on' in text, 'Settings says work mode is on')
            check('built' in text, 'Settings names the pinned build')

            if with_docket:
                pg.goto(f'{url}/#/prioritizer')
                dframe = None
                for _ in range(75):
                    dframe = next((f for f in pg.frames if '/apps/prioritizer/' in f.url), None)
                    if dframe and dframe.locator('body').count() and dframe.inner_text('body').strip():
                        break
                    pg.wait_for_timeout(200)
                check(dframe is not None and bool(dframe.inner_text('body').strip()), 'Docket opens inside the hub from the pinned copy')
                # Docket reaches the agent like any app: its board is saved in the data folder, not the browser.
                saved = False
                for _ in range(50):
                    if os.path.isdir(os.path.join(data, 'prioritizer')) and os.listdir(os.path.join(data, 'prioritizer')):
                        saved = True
                        break
                    pg.wait_for_timeout(200)
                check(saved, 'Docket saves its board in the data folder through the agent')

            check(not foreign, 'no request went anywhere but this computer' + (f': {foreign[:3]}' if foreign else ''))
            browser.close()
    finally:
        proc.stdin.close()
        proc.wait(timeout=10)
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
    print(f'\n{"All work mode checks passed." if failures == 0 else f"{failures} work mode check(s) failed."}')
    sys.exit(1 if failures else 0)
