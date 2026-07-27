import { useLocation } from "@solidjs/router";
import { createResource, For, Show } from "solid-js";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { resolveBreadcrumbs } from "~/lib/breadcrumbs";

/**
 * Renders the breadcrumb trail for the current route, derived from the
 * central route metadata in ~/lib/breadcrumbs (not hand-maintained per page).
 * Only ever mounted inside AppShell, i.e. within the protected layout.
 */
export function Breadcrumbs() {
  const location = useLocation();
  const [segments] = createResource(() => location.pathname, resolveBreadcrumbs);

  return (
    <Show when={(segments() ?? []).length > 0}>
      <div class="border-b">
        <div class="mx-auto max-w-4xl px-4 py-2">
          <Breadcrumb>
            <BreadcrumbList>
              <For each={segments()}>
                {(segment, index) => (
                  <>
                    <Show when={index() > 0}>
                      <BreadcrumbSeparator />
                    </Show>
                    <BreadcrumbItem>
                      <Show when={segment.href} fallback={<BreadcrumbPage>{segment.label}</BreadcrumbPage>}>
                        <BreadcrumbLink href={segment.href!}>{segment.label}</BreadcrumbLink>
                      </Show>
                    </BreadcrumbItem>
                  </>
                )}
              </For>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </div>
    </Show>
  );
}
