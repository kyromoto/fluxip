import { createResource, Show, type Component } from "solid-js";
import { api } from "~/services/api";

/** "1.4.2" -> "v1.4.2"; anything that isn't a plain version ("dev") is shown as is. */
export function formatVersion(version: string): string {
  return /^\d/.test(version) ? `v${version}` : version;
}

/** The running FluxIP version, small and muted. Shows nothing if the backend can't be asked. */
export const VersionLabel: Component = () => {
  const [version] = createResource(async () => {
    try {
      return (await api.get<{ version: string }>("/version")).version;
    } catch {
      return null;
    }
  });

  return (
    <Show when={version()}>
      {(value) => (
        <span class="text-[11px] leading-none text-muted-foreground" title="Running FluxIP version" data-testid="app-version">
          {formatVersion(value())}
        </span>
      )}
    </Show>
  );
};
