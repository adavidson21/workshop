/* Prioritizer: keeps Workshop's people directory (directory-model.js) up to date: reads Settings' `people`
   once connected, and again whenever it changes. Read only; Docket never writes it. */
import { readDirectory, setDirectory, linkPeople } from './directory-model.js';
import { ready } from './ws.js';
import { commit, state } from './state.js';
import { render } from './render.js';

async function load(ws){
  let env = null;
  try { env = await ws.data.get('people', {app: 'settings'}); } catch (e) { env = null; }
  setDirectory(readDirectory(env));
  // A new link is saved with the board; otherwise only suggestions changed.
  if (linkPeople(state)) commit(); else render();
}

/** Call once the board is loaded, so links are made against the saved people. */
async function startDirectory(){
  const ws = await ready;
  if (!ws) return;
  await load(ws);
  ws.data.subscribe('people', () => load(ws), {app: 'settings'});
}

export { startDirectory };
