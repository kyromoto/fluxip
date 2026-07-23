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
  storedAt: string;
}

export interface ProviderCredentialRotatedData {
  encryptedSecret: string;
  rotatedAt: string;
}

export interface ProviderCredentialRevokedData {
  revokedAt: string;
}
