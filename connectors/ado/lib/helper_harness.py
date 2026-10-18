"""
Runs functions from ado_helper.py and prints their JSON results, for parity checks.

Used by the golden tests (connectors/ado/test) and by `doctor.mjs --compare`. Reads one JSON request on
stdin and writes one JSON response on stdout. Writes no files. Never prints the PAT.

Request:  {"helper": "<path to ado_helper.py>", "config": {...} | null, "now": "<ISO time>" | null,
           "calls": [{"fn": "sync", "known": [], "knownPrs": []}, {"fn": "dataset", "req": {...}}]}
          config null means the helper's own ado-helper.json next to the script.
Response: {"results": [{"ok": <result>} | {"error": "<message>"}]}
"""
import importlib.util
import json
import os
import sys
from datetime import datetime

sys.dont_write_bytecode = True   # no __pycache__ next to the helper


def load_helper(path):
    spec = importlib.util.spec_from_file_location('ado_helper_under_test', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    req = json.load(sys.stdin)
    h = load_helper(os.path.abspath(req['helper']))
    if req.get('config') is not None:
        cfg = dict(h.DEFAULTS)
        cfg.update(req['config'])
        cfg['base_url'] = cfg['base_url'].rstrip('/')
    else:
        cfg = h.load_config()
    if req.get('now'):
        fixed = datetime.fromisoformat(req['now'].replace('Z', '+00:00'))

        class FixedDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return fixed.astimezone(tz) if tz else fixed.replace(tzinfo=None)

        h.datetime = FixedDatetime
    results = []
    for call in req.get('calls') or []:
        try:
            if call['fn'] == 'sync':
                known = [int(x) for x in call.get('known') or []]
                results.append({'ok': h.sync(cfg, known, call.get('knownPrs') or [])})
            elif call['fn'] == 'dataset':
                results.append({'ok': h.dataset(cfg, call.get('req') or {})})
            else:
                results.append({'error': 'Unknown function ' + str(call['fn'])})
        except h.HelperError as e:
            results.append({'error': str(e)})
    json.dump({'results': results}, sys.stdout)


if __name__ == '__main__':
    main()
