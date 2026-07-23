/** Maps a Provider Credential's `provider` field to a user-facing Credential Type label (FR-005). */
const CREDENTIAL_TYPE_LABELS: Record<string, string> = {
  hetzner: "Hetzner API Token",
};

/** Total function: falls back to the raw value so an unrecognized future type still renders something. */
export function credentialTypeLabel(provider: string): string {
  return CREDENTIAL_TYPE_LABELS[provider] ?? provider;
}
