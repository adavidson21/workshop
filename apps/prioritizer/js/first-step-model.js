/* Docket: a task's first step and Split (Stuck, focus.js). Pure, so state.js and Node tests can use it.

   t.firstStep is an optional line (at most FIRST_STEP_LEN characters): the smallest next action. While the task
   runs, the focus band and Workshop's top bar show it large and the title small. Marking the task done clears it;
   starting it does not. It is an extra field on prioritizer.tasks, so tasks stay at v3. */
export const FIRST_STEP_LEN = 120;

/** A cleaned first step: one line, trimmed, at most FIRST_STEP_LEN characters. '' when there is none. */
export function cleanFirstStep(v){
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, FIRST_STEP_LEN) : '';
}
/** Sets (or, for blank text, removes) a task's first step. Returns true if it changed. */
export function setFirstStep(t, text){
  if (!t) return false;
  const v = cleanFirstStep(text), had = t.firstStep || '';
  if (v) t.firstStep = v; else delete t.firstStep;
  return v !== had;
}
/** Done clears the first step. Returns true if there was one. */
export function clearFirstStep(t){
  if (!t || !('firstStep' in t)) return false;
  delete t.firstStep;
  return true;
}

/* Split: the rest of task t becomes its own task right below it in the rank, in the same list, with the same people,
   due date, value, effort, color and product. It starts fresh: not on Today, not waiting, no breadcrumbs or first
   step. t goes on Today (today). tasks is the board's task list; the new task is added to it and returned, or null
   for a blank title or a finished task. */
export function splitTask(tasks, t, restTitle, {id, today}){
  const title = typeof restTitle === 'string' ? restTitle.replace(/\s+/g, ' ').trim() : '';
  if (!t || t.done || !title || !id) return null;
  for (const x of tasks) if (x !== t && x.rank > t.rank) x.rank++;
  const rest = {
    id, title, notes: '', color: t.color, rank: t.rank + 1,
    value: t.value ?? null, effort: t.effort ?? null, due: t.due ?? null, urgentFlag: t.urgentFlag === true,
    listId: t.listId, done: false, doneAt: null, wontDo: false, createdAt: today, ageFrom: today,
    waiting: false, nudgeOn: null, focusOn: null, who: Array.isArray(t.who) ? [...t.who] : []
  };
  if (t.product) rest.product = t.product;
  tasks.push(rest);
  t.focusOn = today;
  return rest;
}
