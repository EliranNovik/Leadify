export const RMQ_AI_OPEN_EVENT = 'rmq-ai-open';
const RMQ_AI_PENDING_PROMPT_KEY = 'rmqAiPendingPrompt';

export const RMQ_AI_DASHBOARD_ASKS = [
  "What's on my calendar today?",
  "Who hasn't answered me?",
  'Which deals signed today?',
] as const;

export function openRmqAiChat(prompt?: string) {
  try {
    if (prompt?.trim()) {
      sessionStorage.setItem(RMQ_AI_PENDING_PROMPT_KEY, prompt.trim());
    } else {
      sessionStorage.removeItem(RMQ_AI_PENDING_PROMPT_KEY);
    }
    window.dispatchEvent(new CustomEvent(RMQ_AI_OPEN_EVENT));
  } catch {
    window.dispatchEvent(new CustomEvent(RMQ_AI_OPEN_EVENT));
  }
}

export function takeRmqAiPendingPrompt(): string | null {
  try {
    const raw = sessionStorage.getItem(RMQ_AI_PENDING_PROMPT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(RMQ_AI_PENDING_PROMPT_KEY);
    const prompt = raw.trim();
    return prompt || null;
  } catch {
    return null;
  }
}
