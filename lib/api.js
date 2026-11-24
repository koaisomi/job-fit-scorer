// Claude Messages API over raw fetch (unbundled extension, no SDK).
const URL_MESSAGES = 'https://api.anthropic.com/v1/messages';
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export class ApiError extends Error {}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

// stream: true uses SSE with max_tokens 64000 (long outputs); otherwise one JSON response with 16000.
export async function callClaude({ apiKey, model, effort, system, content, schema, signal, stream = false }) {
  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2026-10-21',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const body = {
    model,
    max_tokens: stream ? 64000 : 16000,
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  };
  if (stream) body.stream = true;
  if (FALLBACK_MODELS.has(model)) {
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(URL_MESSAGES, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new ApiError('Could not reach the Claude API. Check your connection and try again.');
    }
    if (res.ok) return parseMessage(stream ? await readStream(res) : await res.json());

    const err = await res.json().catch(() => null);
    const message = err?.error?.message || res.statusText || 'Unknown error';
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt === 0) {
      const wait = Number(res.headers.get('retry-after'));
      await sleep((Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30) : 3) * 1000, signal);
      continue;
    }
    if (res.status === 401) throw new ApiError('Invalid API key. Check it in Settings.');
    if (res.status === 429) throw new ApiError('Rate limit reached. Wait a minute and try again.');
    if (res.status === 529) throw new ApiError('Claude is overloaded right now. Try again in a minute.');
    if (res.status >= 500) throw new ApiError(`Claude API error (${res.status}). Try again in a minute.`);
    throw new ApiError(`Request failed (${res.status}): ${message}`);
  }
}

// Reads an SSE response into a message-like object: text deltas only, plus stop_reason/stop_details.
export async function readStream(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  const msg = { stop_reason: null, stop_details: null, content: [] };
  const handle = (raw) => {
    const data = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    let ev;
    try {
      ev = JSON.parse(data);
    } catch {
      return;
    }
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'fallback') text = ''; // fallback model restarts the answer
    else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') text += ev.delta.text;
    else if (ev.type === 'message_delta') {
      if (ev.delta?.stop_reason) msg.stop_reason = ev.delta.stop_reason;
      if (ev.delta?.stop_details) msg.stop_details = ev.delta.stop_details;
    } else if (ev.type === 'error') throw new ApiError('Claude API error: ' + (ev.error?.message || 'stream failed') + '. Try again.');
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
  }
  if (buf.trim()) handle(buf);
  msg.content = [{ type: 'text', text }];
  return msg;
}

export function parseMessage(data) {
  if (data.stop_reason === 'refusal') {
    const why = data.stop_details?.explanation;
    throw new ApiError('Claude declined this request.' + (why ? ' ' + why : ''));
  }
  if (data.stop_reason === 'max_tokens') {
    throw new ApiError('The answer was cut off before it finished. Try a lower effort, or Rescore.');
  }
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('Claude returned an answer that could not be read. Try again.');
  }
}
