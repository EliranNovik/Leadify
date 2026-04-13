/**
 * Pasted URLs often contain a space or newline right after "http(s)://", which breaks
 * link detection so only the host path is linked and the scheme stays plain text.
 */
export function normalizeMessageUrlsForLinkify(text: string): string {
  return text.replace(/(https?:\/\/)[\s\u00a0]+/gi, '$1');
}
