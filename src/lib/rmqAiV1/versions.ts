/** RMQ AI v1 runtime versions — stamp every turn. Bump when that contract changes. */
export const RMQ_AI_MODEL_VERSION = 'gpt-5.6-sol';
export const RMQ_AI_FALLBACK_MODEL_VERSION = 'gpt-4o-mini';
export const RMQ_AI_PROMPT_VERSION = 'rmq-system-v1';
export const RMQ_AI_TOOL_CONTRACT_VERSION = 'tools-v1';
export const RMQ_AI_RESOLVER_VERSION = 'lead-resolver-v1';
export const RMQ_AI_ARCHITECTURE_VERSION = 'v1';

export type RmqAiVersionStamp = {
  architectureVersion: string;
  modelVersion: string;
  promptVersion: string;
  toolContractVersion: string;
  resolverVersion: string;
};

export function currentRmqAiVersions(): RmqAiVersionStamp {
  return {
    architectureVersion: RMQ_AI_ARCHITECTURE_VERSION,
    modelVersion: RMQ_AI_MODEL_VERSION,
    promptVersion: RMQ_AI_PROMPT_VERSION,
    toolContractVersion: RMQ_AI_TOOL_CONTRACT_VERSION,
    resolverVersion: RMQ_AI_RESOLVER_VERSION,
  };
}
