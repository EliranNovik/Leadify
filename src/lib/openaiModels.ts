export const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
export const OPENAI_CHAT_MODEL = 'gpt-6.1-sol';

export type OpenAiReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ChatCompletionBodyInput = {
  messages: unknown;
  tools?: unknown;
  tool_choice?: unknown;
  maxTokens?: number;
  temperature?: number;
  response_format?: unknown;
  stream?: boolean;
  reasoningEffort?: OpenAiReasoningEffort;
};

/** gpt-5.6 / gpt-6.x Sol only accept the default temperature (1); custom values are rejected. */
function modelSupportsCustomTemperature(model: string): boolean {
  return !/^gpt-(5\.6|6(\.|$))/i.test(model);
}

export function buildChatCompletionBody(input: ChatCompletionBodyInput): Record<string, unknown> {
  const hasTools = Array.isArray(input.tools) && input.tools.length > 0;

  const body: Record<string, unknown> = {
    model: OPENAI_CHAT_MODEL,
    messages: input.messages,
  };

  // Only send when the caller opts in — many models/proxies reject this field.
  if (input.reasoningEffort) {
    body.reasoning_effort = input.reasoningEffort;
  }

  if (input.maxTokens != null) {
    body.max_completion_tokens = input.maxTokens;
  }
  if (
    input.temperature != null &&
    (input.reasoningEffort == null || input.reasoningEffort === 'none') &&
    modelSupportsCustomTemperature(OPENAI_CHAT_MODEL)
  ) {
    body.temperature = input.temperature;
  }
  if (hasTools) {
    body.tools = input.tools;
    if (input.tool_choice != null) body.tool_choice = input.tool_choice;
  }
  if (input.response_format != null) {
    body.response_format = input.response_format;
  }
  if (input.stream) {
    body.stream = true;
  }

  return body;
}
