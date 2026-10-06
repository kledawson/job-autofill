// Background worker only. The API key never leaves this module's callers.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_ATTEMPTS = 4;

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(new GeminiError('Gemini request was cancelled.')); return; }
  const finish = () => { signal?.removeEventListener('abort', cancel); resolve(); };
  const timer = setTimeout(finish, ms);
  const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(new GeminiError('Gemini request was cancelled.')); };
  signal?.addEventListener('abort', cancel, { once: true });
});

/** Delay Gemini asks for on 429 ("retryDelay": "23s"), capped so a fill never hangs for long. */
function retryDelay(body: any, attempt: number): number {
  const hint = body?.error?.details?.find?.((d: any) => d?.retryDelay)?.retryDelay as string | undefined;
  const hinted = hint ? parseFloat(hint) * 1000 : 0;
  const backoff = 1500 * 2 ** attempt + Math.random() * 500;
  return Math.min(Math.max(hinted, backoff), 30000);
}

async function call(apiKey: string, model: string, path: string, init: RequestInit): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey, ...(init.headers ?? {}) },
      });
    } catch {
      if (init.signal?.aborted) throw new GeminiError('Gemini request was cancelled.');
      if (attempt + 1 >= MAX_ATTEMPTS) throw new GeminiError('Could not reach Gemini. Check your connection.');
      await sleep(retryDelay(null, attempt), init.signal ?? undefined);
      continue;
    }
    const body = await res.json().catch(() => null);
    if (res.ok) return body;

    const retryable = res.status === 429 || res.status === 500 || res.status === 503;
    if (retryable && attempt + 1 < MAX_ATTEMPTS) {
      await sleep(retryDelay(body, attempt), init.signal ?? undefined);
      continue;
    }
    const detail = body?.error?.message ?? res.statusText;
    if (res.status === 400 && /api key/i.test(detail)) throw new GeminiError('Your Gemini API key is invalid.', 400);
    if (res.status === 403) throw new GeminiError('Your Gemini API key was rejected. Check it in settings.', 403);
    if (res.status === 404) throw new GeminiError(`Gemini model "${model}" was not found. Change it in settings.`, 404);
    if (res.status === 429) throw new GeminiError('Gemini free-tier rate limit reached. Try again in a minute.', 429);
    throw new GeminiError(`Gemini error ${res.status}: ${detail}`, res.status);
  }
}

// One request at a time keeps us inside free-tier per-minute limits.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

function generate(apiKey: string, model: string, parts: Part[], generationConfig: object, signal?: AbortSignal): Promise<string> {
  return enqueue(async () => {
    const body = await call(apiKey, model, ':generateContent', {
      method: 'POST',
      signal,
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
    });
    const candidate = body?.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((p: any) => !p.thought)
      .map((p: any) => p.text ?? '')
      .join('')
      .trim();
    if (!text) {
      const reason = candidate?.finishReason ?? body?.promptFeedback?.blockReason ?? 'no text';
      throw new GeminiError(`Gemini returned no answer (${reason}).`);
    }
    return text;
  });
}

export function generateText(apiKey: string, model: string, prompt: string): Promise<string> {
  return generate(apiKey, model, [{ text: prompt }], { temperature: 0.7 });
}

/**
 * Returns the parsed JSON reply (unvalidated) for a text or PDF input. Asks for low "thinking" to keep it
 * fast, and retries without that setting if the configured model does not accept it.
 */
export async function generateJson(
  apiKey: string,
  model: string,
  prompt: string,
  input: { text: string } | { pdfBase64: string },
  responseSchema: object,
): Promise<unknown> {
  const parts: Part[] =
    'text' in input
      ? [{ text: `${prompt}\n\nResume text:\n${input.text}` }]
      : [{ inline_data: { mime_type: 'application/pdf', data: input.pdfBase64 } }, { text: prompt }];
  return generateStructured(apiKey, model, parts, responseSchema);
}

/** JSON reply to a prompt alone (no resume attached). */
export function generatePromptJson(apiKey: string, model: string, prompt: string, responseSchema: object, signal?: AbortSignal): Promise<unknown> {
  return generateStructured(apiKey, model, [{ text: prompt }], responseSchema, signal);
}

async function generateStructured(apiKey: string, model: string, parts: Part[], responseSchema: object, signal?: AbortSignal): Promise<unknown> {
  const config = { temperature: 0, responseMimeType: 'application/json', responseSchema };
  let text: string;
  try {
    text = await generate(apiKey, model, parts, { ...config, thinkingConfig: { thinkingLevel: 'low' } }, signal);
  } catch (err) {
    if (!(err instanceof GeminiError && err.status === 400 && /thinking/i.test(err.message))) throw err;
    text = await generate(apiKey, model, parts, config, signal);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiError('Gemini returned something that was not valid JSON. Try again.');
  }
}

/** Cheap key check: fetch the model's metadata. */
export async function testKey(apiKey: string, model: string): Promise<void> {
  await call(apiKey, model, '', { method: 'GET' });
}
