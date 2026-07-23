export const PROVIDER_CREDENTIAL_AGGREGATE_TYPE = "provider_credential";

export const ProviderCredentialEventName = {
  Stored: "stored",
  Rotated: "rotated",
  Revoked: "revoked",
} as const;

export interface ProviderCredentialStoredData {
  credentialId: string;
  accountId: string;
  provider: string;
  label: string;
  encryptedSecret: string;
  /** Cleartext last-4 fragment of the secret, captured once at creation time — the only part of the secret ever returned by a read (FR-004/FR-004a). */
  secretLast4: string;
  storedAt: string;
}

export interface ProviderCredentialRotatedData {
  encryptedSecret: string;
  rotatedAt: string;
}

export interface ProviderCredentialRevokedData {
  revokedAt: string;
}
