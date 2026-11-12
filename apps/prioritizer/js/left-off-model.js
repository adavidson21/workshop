/* Docket: where you left off on a task (left-off.js), the pure part, so state.js and Node tests can use it. */
export const LEFT_OFF_LEN = 280;

/** A cleaned leftOff, or null. */
export function cleanLeftOff(v){
  if (!v || typeof v !== 'object' || typeof v.text !== 'string') return null;
  const text = v.text.replace(/\s+/g, ' ').trim().slice(0, LEFT_OFF_LEN);
  return text ? {text, at: typeof v.at === 'string' ? v.at : ''} : null;
}
/** Saves where you left off on a task. False for an empty text or a missing or finished task. */
export function setLeftOff(t, text, at = new Date().toISOString()){
  const lo = cleanLeftOff({text, at});
  if (!t || t.done || !lo) return false;
  t.leftOff = lo;
  return true;
}

