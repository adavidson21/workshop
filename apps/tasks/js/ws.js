/* Tasks' connection to the Workshop shell and backends, through the SDK (shared/workshop-sdk.js).
   One connection for the whole app. Other modules import `ws` (the live handle, null until connected)
   and `ready` (a promise that resolves once connect() finishes). */
import { connect } from '../../../shared/workshop-sdk.js';

let ws = null;
const ready = connect({ app: 'tasks' }).then(w => { ws = w; return w; }).catch(() => null);

// `embedded` is known synchronously the same way the SDK decides it, so startup can branch before
// the connection resolves (hiding the shell-owned theme button, choosing who registers the worker).
const embedded = (() => { try { return window.parent !== window && window.parent.location.origin === location.origin; } catch (e) { return false; } })();

// Tasks' Handed off view belongs to the Management area (shared/areas.js, docs/apps.md Areas): hidden while it is
// off. On until the connection says otherwise.
const peoplePlaceOn = () => !(ws && ws.areas && !ws.areas.partOn('people'));

export { ws, ready, embedded, peoplePlaceOn };
