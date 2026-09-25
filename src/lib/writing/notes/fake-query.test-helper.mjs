export function fakeQuery(routes) {
  // routes: array of [substringOrRegex, (params) => rows]
  const calls = [];
  const q = async (text, params = []) => {
    calls.push({ text, params });
    for (const [match, handler] of routes) {
      const hit = typeof match === 'string' ? text.includes(match) : match.test(text);
      if (hit) return { data: handler(params, text) ?? [], error: null };
    }
    return { data: [], error: null };
  };
  return { q, calls };
}
