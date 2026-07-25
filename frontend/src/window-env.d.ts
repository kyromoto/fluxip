export interface WindowEnv {
  readonly LOGTO_ENDPOINT?: string;
  readonly LOGTO_APP_ID?: string;
  readonly LOGTO_API_RESOURCE?: string;
  readonly BACKEND_URL?: string;
}

declare global {
  interface Window {
    __ENV__?: WindowEnv;
  }
}
