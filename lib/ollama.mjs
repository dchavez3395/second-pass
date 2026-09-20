/**
 * One call into a local Ollama model, tuned for "answer as JSON" prompts.
 *
 * JSON mode is deliberately not used: with qwen3-vl the model spends its budget
 * thinking and returns nothing. think:false plus a JSON-only instruction is fast,
 * and the object (or array) is pulled out of the text. Truncated objects are
 * salvaged field by field where possible.
 */
export const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

export async function ollamaReady(model) {
  const tags = await fetch(`${OLLAMA}/api/tags`).then((r) => r.json()).catch(() => null);
  if (!tags) return `Ollama is not answering at ${OLLAMA}.`;
  if (!tags.models.some((m) => m.name === model || m.name === `${model}:latest`)) return `Model ${model} is not installed. Run: ollama pull ${model}`;
  return null;
}

export async function chat({ model, content, images = [], maxTokens = 700, temperature = 0, prefill = '' }) {
  // A trailing assistant message is continued by the model. Prefilling the start of
  // the JSON is the one thing that reliably stops qwen3-vl thinking out loud on
  // text-only prompts (think:false and /no_think do not).
  const body = {
    model,
    stream: false,
    think: false,
    options: { temperature, num_predict: maxTokens },
    messages: [{ role: 'user', content, ...(images.length ? { images } : {}) }, ...(prefill ? [{ role: 'assistant', content: prefill }] : [])],
  };
  const r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const raw = (j.message.content || '').trim() || (j.message.thinking || '').trim();
  return { raw: prefill ? prefill + raw : raw, ms: Math.round((j.total_duration || 0) / 1e6) };
}

/** First JSON value (object or array) in a blob of model text, or null. */
export function extractJson(raw, want = 'object') {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const re = want === 'array' ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
  const m = text.match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {}
  // Truncated: try trimming back to the last complete element.
  let s = m[0];
  for (let i = 0; i < 6; i++) {
    const cut = want === 'array' ? s.lastIndexOf('},') : s.lastIndexOf(',');
    if (cut < 0) break;
    s = s.slice(0, cut) + (want === 'array' ? '}]' : '}');
    try {
      return JSON.parse(s);
    } catch {}
  }
  return null;
}

/** Ask once; if the answer is not usable JSON, ask again more firmly. */
export async function askJson(opts, want = 'object') {
  if (opts.prefill === undefined) opts = { ...opts, prefill: want === 'array' ? '[{"n": 1,' : '{"verdict":' };
  let { raw, ms } = await chat(opts);
  let out = extractJson(raw, want);
  if (!out) {
    const again = await chat({ ...opts, content: opts.content + `\n\nOutput only the JSON ${want}, nothing before or after it. Do not think out loud.` });
    ms += again.ms;
    raw = again.raw;
    out = extractJson(raw, want);
  }
  return { out, raw, ms };
}
