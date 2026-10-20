// Chat websites that can draft free responses instead of the Gemini API. The person reads the prompt,
// presses Send and copies the reply themselves: nothing here sends a message or reads a reply.

export const CHAT_PROVIDER_IDS = ['chatgpt', 'claude', 'gemini', 'perplexity'] as const;
export type ChatProviderId = (typeof CHAT_PROVIDER_IDS)[number];
/** Who writes free responses: nobody (the person), the Gemini API with the saved key, or a chat website the person uses. */
export type AnswerSource = 'none' | 'gemini-api' | ChatProviderId;

export interface ChatProvider {
  id: ChatProviderId;
  name: string;
  /** Opened as a new chat. Nothing is put in the URL: the prompt holds profile details. */
  url: string;
  /** Optional host permission asked for when the person picks this provider. */
  origins: string[];
  /** Message boxes, most specific first. */
  composers: string[];
}

export const CHAT_PROVIDERS: Record<ChatProviderId, ChatProvider> = {
  chatgpt: {
    id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', origins: ['https://chatgpt.com/*'],
    composers: ['#prompt-textarea', 'textarea[name="prompt"]', '[contenteditable="true"][aria-label*="ChatGPT" i]', 'textarea[aria-label*="ChatGPT" i]'],
  },
  claude: {
    id: 'claude', name: 'Claude', url: 'https://claude.ai/new', origins: ['https://claude.ai/*'],
    composers: ['[contenteditable="true"][aria-label*="prompt" i]', 'fieldset .ProseMirror[contenteditable="true"]', '.ProseMirror[contenteditable="true"]'],
  },
  gemini: {
    id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', origins: ['https://gemini.google.com/*'],
    composers: ['rich-textarea .ql-editor[contenteditable="true"]', '[contenteditable="true"][aria-label*="prompt" i]'],
  },
  perplexity: {
    id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/', origins: ['https://www.perplexity.ai/*', 'https://perplexity.ai/*'],
    composers: ['#ask-input', 'textarea[placeholder*="ask" i]'],
  },
};

/** Tried after a provider's own selectors, in case a redesign renames them. */
const FALLBACK_COMPOSERS = ['main [contenteditable="true"][role="textbox"]', 'form [contenteditable="true"][role="textbox"]', 'main form textarea', 'form textarea'];

export const ANSWER_SOURCES: [AnswerSource, string][] = [
  ['none', 'None'],
  ['gemini-api', 'Gemini API'],
  ...CHAT_PROVIDER_IDS.map(id => [id, id === 'gemini' ? 'Gemini (website)' : CHAT_PROVIDERS[id].name] as [AnswerSource, string]),
];

/** A stored choice; before the person has chosen, Gemini API when a key is saved and otherwise none. */
export function parseAnswerSource(value: unknown, hasGeminiKey = false): AnswerSource {
  if (value === 'none' || value === 'gemini-api' || CHAT_PROVIDER_IDS.includes(value as ChatProviderId)) return value as AnswerSource;
  return hasGeminiKey ? 'gemini-api' : 'none';
}

export function chatProviderFor(source: AnswerSource | undefined): ChatProvider | undefined {
  return source && source !== 'gemini-api' && source !== 'none' ? CHAT_PROVIDERS[source] : undefined;
}

/** One line on what the choice does, for the side panel and Settings. */
export function answerSourceHint(source: AnswerSource, hasGeminiKey: boolean): string {
  const chat = chatProviderFor(source);
  if (chat) return `Free responses are left empty. Draft in ${chat.name} opens a chat with your prompt; you press Send and paste the reply back.`;
  if (source === 'gemini-api') return hasGeminiKey ? 'Gemini writes free responses while filling, using your API key.' : 'Add a Gemini API key in Settings → Connections to use this.';
  return 'Free responses are left for you to answer.';
}

/** True when `url` is on one of the provider's own sites (a sign-in redirect elsewhere is not). */
export function onProviderSite(provider: ChatProvider, url: string | undefined): boolean {
  let origin: string;
  try { origin = new URL(url ?? '').origin; } catch { return false; }
  return provider.origins.some(pattern => pattern.replace(/\/\*$/, '') === origin);
}

export function composerSelectors(provider: ChatProvider): string[] {
  return [...provider.composers, ...FALLBACK_COMPOSERS];
}

export type InsertResult = 'inserted' | 'occupied' | 'missing' | 'rejected' | 'busy';

/**
 * Puts `prompt` in the chat's empty message box and leaves it there for the person to read and send.
 * Runs in the chat tab through scripting.executeScript, so it must not use anything from outside its body.
 * It types with the same editing commands as a paste, so the site's editor keeps its own state. It never
 * clicks, submits, or reads anything except the message box it writes, and never replaces text already typed.
 */
export async function insertPrompt(prompt: string, selectors: string[], timeoutMs: number): Promise<InsertResult> {
  const w = window as Window & { __jobAutofillInserting?: boolean };
  if (w.__jobAutofillInserting) return 'busy';
  w.__jobAutofillInserting = true;
  try {
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const find = () => {
      for (const selector of selectors) {
        const el = [...document.querySelectorAll<HTMLElement>(selector)].find(visible);
        if (el) return el;
      }
      return null;
    };
    let box = find();
    for (const end = Date.now() + timeoutMs; !box && Date.now() < end;) { await wait(300); box = find(); }
    if (!box) return 'missing';
    const plain = box instanceof HTMLTextAreaElement || box instanceof HTMLInputElement;
    const read = () => (plain ? (box as HTMLTextAreaElement).value : box!.innerText).replace(/\s+/g, ' ').trim();
    if (read()) return 'occupied';
    box.focus();
    const expected = prompt.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!plain) {
      // Rich editors (ProseMirror, Lexical, Quill) keep line breaks from a paste.
      const data = new DataTransfer();
      data.setData('text/plain', prompt);
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      await wait(150);
    }
    if (!read()) {
      document.execCommand('insertText', false, prompt);
      await wait(150);
    }
    return read().includes(expected) ? 'inserted' : 'rejected';
  } finally {
    w.__jobAutofillInserting = false;
  }
}
