import { api } from "~/services/api";

export interface BreadcrumbSegment {
  label: string;
  /** Omitted for the current (last) segment, which is not clickable. */
  href?: string;
}

interface IpClientSummary {
  ipClientId: string;
  label: string;
}

interface ExecutionSummary {
  ipClientId: string;
}

async function fetchDeviceLabel(ipClientId: string): Promise<string> {
  const device = await api.get<IpClientSummary>(`/ip-clients/${ipClientId}`);
  return device.label;
}

interface RouteMeta {
  pattern: string;
  resolve: (params: Record<string, string>) => BreadcrumbSegment[] | Promise<BreadcrumbSegment[]>;
}

/**
 * Central route metadata: links each route pattern to the breadcrumb trail
 * it produces, so display names live in one place instead of per page.
 * Dynamic segments (e.g. :ipClientId) are resolved to human-readable names
 * (device label) via the API rather than shown as raw IDs.
 */
const ROUTES: RouteMeta[] = [
  { pattern: "/", resolve: () => [{ label: "Devices" }] },
  { pattern: "/ip-clients", resolve: () => [{ label: "Devices" }] },
  {
    pattern: "/ip-clients/:ipClientId/actions",
    resolve: async ({ ipClientId }) => {
      const label = await fetchDeviceLabel(ipClientId).catch(() => ipClientId);
      return [{ label: "Devices", href: "/ip-clients" }, { label }];
    },
  },
  {
    pattern: "/actions/:actionId/executions",
    resolve: async ({ actionId }) => {
      // This route isn't nested under its device in the URL, so the device
      // has to be resolved indirectly via the action's own executions.
      try {
        const { items } = await api.get<{ items: ExecutionSummary[] }>(`/actions/${actionId}/executions`);
        const ipClientId = items[0]?.ipClientId;
        if (!ipClientId) throw new Error("device unknown");
        const label = await fetchDeviceLabel(ipClientId);
        return [
          { label: "Devices", href: "/ip-clients" },
          { label, href: `/ip-clients/${ipClientId}/actions` },
          { label: "Update history" },
        ];
      } catch {
        return [{ label: "Devices", href: "/ip-clients" }, { label: "Update history" }];
      }
    },
  },
  { pattern: "/credentials", resolve: () => [{ label: "Credentials" }] },
  { pattern: "/notifications", resolve: () => [{ label: "Notifications" }] },
  { pattern: "/account", resolve: () => [{ label: "Account" }] },
];

function compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regex = new RegExp(
    "^" +
      pattern
        .split("/")
        .map((segment) => {
          if (segment.startsWith(":")) {
            paramNames.push(segment.slice(1));
            return "([^/]+)";
          }
          return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("/") +
      "$",
  );
  return { regex, paramNames };
}

const COMPILED_ROUTES = ROUTES.map((meta) => ({ meta, ...compilePattern(meta.pattern) }));

function matchRoute(pathname: string): { meta: RouteMeta; params: Record<string, string> } | null {
  for (const { meta, regex, paramNames } of COMPILED_ROUTES) {
    const match = regex.exec(pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    paramNames.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1]);
    });
    return { meta, params };
  }
  return null;
}

export async function resolveBreadcrumbs(pathname: string): Promise<BreadcrumbSegment[]> {
  const matched = matchRoute(pathname);
  if (!matched) return [];
  return matched.meta.resolve(matched.params);
}
