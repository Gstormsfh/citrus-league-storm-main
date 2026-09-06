/** Explicit permission before the current question and context leave Citrus. */
export function confirmStormySharing(): boolean {
  return window.confirm(
    'Send to Stormy?\n\nStormy uses Anthropic (Claude). Your question, recent chat messages, and relevant league, roster and matchup details will be sent to Anthropic to generate an answer. Avoid including sensitive personal information.\n\nChoose OK to send this question, or Cancel to keep it here. See the Privacy Policy for details.',
  );
}
