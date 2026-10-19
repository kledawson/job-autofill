import { sendToBackground } from '@/lib/messages';
const attempt = new URLSearchParams(location.hash.slice(1)).get('queue');
if (attempt) void sendToBackground('queueOpening', { attempt }).catch(() => undefined);
