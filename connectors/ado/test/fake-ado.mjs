// A fake Azure DevOps Server on 127.0.0.1 for tests. Serves synthetic fixtures shaped like the public
// Azure DevOps REST API reference (learn.microsoft.com/rest/api/azure/devops). No real ADO data.
//
// Scenario shape (see fixtures/):
//   pat                     the PAT the server accepts (Basic auth, empty user)
//   root.connectionData     answer for GET /_apis/connectionData at the server root
//   collections.<name>:
//     connectionData        object, or {$status: 404}
//     wiql                  [{match: [substrings that must all appear], ids: [...]}], first match wins
//     workItems             {id: work item}
//     updates               {id: [update]}
//     teams                 {project: [team] | {$status}}
//     pullRequests          {project: [pull request]}
//     iterations            {project: node | {$status}}
//     html                  [route substrings answered with a sign-in page]
// "{{ADO}}" anywhere in the scenario becomes the server's URL.
// Every request is recorded in `requests` as "METHOD path?sorted query body".
import http from 'node:http';

function sortedQuery(sp) {
  return [...sp.entries()].sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
}

/** JSON with sorted keys, so two clients that send the same body record the same line. */
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

export async function startFakeAdo(input) {
  const requests = [];
  let scenario = input;
  const auth = 'Basic ' + Buffer.from(':' + scenario.pat).toString('base64');

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const u = new URL(req.url, 'http://fake');
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      requests.push(`${req.method} ${u.pathname}?${sortedQuery(u.searchParams)}${body !== null ? ' ' + canonical(body) : ''}`);
      const send = (status, obj, type = 'application/json; charset=utf-8') => {
        const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
        res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(text) });
        res.end(text);
      };
      if (req.headers.authorization !== auth) return send(401, { message: 'TF400813: not authorized.' });
      try {
        const out = route(req.method, u, body);
        if (out && out.$html) return send(200, '<html><body>Sign in</body></html>', 'text/html; charset=utf-8');
        if (out && out.$status) return send(out.$status, { message: out.message || `Fake error ${out.$status}` });
        return send(200, out);
      } catch (e) {
        return send(500, { message: e.message });
      }
    });
  });

  function route(method, u, body) {
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const api = parts.indexOf('_apis');
    if (api < 0) return { $status: 404 };
    const scope = parts.slice(0, api);
    const rest = parts.slice(api + 1);
    const path = rest.join('/').toLowerCase();
    if (scope.length === 0) {
      if (path === 'connectiondata') return scope0().connectionData || { $status: 404 };
      return { $status: 404 };
    }
    const coll = scenario.collections?.[scope[0]];
    if (!coll) return { $status: 404 };
    if ((coll.html || []).some(h => path.includes(h))) return { $html: true };
    const project = scope[1];
    const q = u.searchParams;

    if (!project) {
      if (method === 'GET' && path === 'connectiondata') return coll.connectionData || { $status: 404 };
      if (method === 'POST' && path === 'wit/wiql') {
        const rule = (coll.wiql || []).find(r => r.match.every(m => body.query.includes(m)));
        return { workItems: (rule ? rule.ids : []).map(id => ({ id, url: `${u.origin}/wit/workItems/${id}` })) };
      }
      if (method === 'POST' && path === 'wit/workitemsbatch') {
        return { count: body.ids.length, value: body.ids.map(id => coll.workItems?.[id]).filter(Boolean) };
      }
      let m = /^wit\/workitems\/(\d+)\/updates$/.exec(path);
      if (method === 'GET' && m) {
        const all = coll.updates?.[m[1]] || [];
        const top = Number(q.get('$top') || 200);
        const skip = Number(q.get('$skip') || 0);
        const page = all.slice(skip, skip + top);
        return { count: page.length, value: page };
      }
      m = /^wit\/workitems\/(\d+)$/.exec(path);
      if (method === 'GET' && m) return coll.workItems?.[m[1]] || { $status: 404, message: `TF401232: Work item ${m[1]} does not exist.` };
      m = /^projects\/(.+)\/teams$/.exec(rest.join('/'));
      if (method === 'GET' && m) {
        const t = coll.teams?.[m[1]];
        if (!t) return { $status: 404 };
        if (t.$status) return t;
        return { count: t.length, value: t };
      }
      return { $status: 404 };
    }

    if (method === 'GET' && path === 'git/pullrequests') {
      const rid = q.get('searchCriteria.reviewerId');
      const status = q.get('searchCriteria.status');
      const list = (coll.pullRequests?.[project] || []).filter(pr => (!status || pr.status === status) && (pr.reviewers || []).some(r => r.id === rid));
      return { count: list.length, value: list };
    }
    const m = /^git\/pullrequests\/(\d+)$/.exec(path);
    if (method === 'GET' && m) return (coll.pullRequests?.[project] || []).find(pr => String(pr.pullRequestId) === m[1]) || { $status: 404 };
    if (method === 'GET' && path === 'wit/classificationnodes/iterations') {
      const it = coll.iterations?.[project];
      return it || { $status: 404 };
    }
    return { $status: 404 };
  }

  const scope0 = () => scenario.root || {};

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  // Fixtures say "{{ADO}}" where the server's own URL goes.
  scenario = JSON.parse(JSON.stringify(input).split('{{ADO}}').join(url));
  return {
    url,
    requests,
    close: () => new Promise(resolve => server.close(resolve))
  };
}
