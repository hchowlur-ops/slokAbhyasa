// What the scoreboard of a take of several slokas suggests under its cards. A sloka recited
// for the first time is better practised on its own a few times before it joins a recital;
// a sloka that came out Needs practice is evaluated alone next — on its own it is judged
// more surely (nothing to cut it from its neighbours), and a clean take of it alone keeps
// its beginning and ending in the learner's voice, which then place it in a recital.
// entries: [{ name, firstTime, needs }] — one per sloka of the take, in the take's order.
// Pure; Node-testable.
const list = (names) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
export function takeAdvice(entries) {
  const es = (entries || []).filter((e) => e && e.name);
  const first = es.filter((e) => e.firstTime);
  const needs = es.filter((e) => e.needs && !e.firstTime);
  const out = [];
  if (first.length) {
    const one = first.length === 1;
    const bad = first.filter((e) => e.needs);
    let s = `${list(first.map((e) => e.name))}: recited for the first time. Practise ${one ? 'it' : 'each'} on its own a few times — evaluate ${one ? 'it' : 'each'} alone until it feels comfortable — before ${one ? 'it joins' : 'they join'} a recital.`;
    if (bad.length) s += ` ${list(bad.map((e) => e.name))} ${bad.length === 1 ? 'is' : 'are'} Needs practice in this take.`;
    out.push(s);
  }
  if (needs.length) {
    const one = needs.length === 1;
    out.push(`${list(needs.map((e) => e.name))}: Needs practice. Evaluate ${one ? 'it' : 'each'} alone, whole and clean; on its own a sloka is judged more surely, and a clean take of it keeps its beginning and ending in your voice, which then place it in a recital.`);
  }
  return out;
}
