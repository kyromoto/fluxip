import { cleanup, render, screen } from "@solidjs/testing-library";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { afterEach, describe, expect, it } from "vitest";
import { DeviceLayout } from "~/components/layout/DeviceLayout";

afterEach(cleanup);

function renderAt(path: string) {
  const history = createMemoryHistory();
  history.set({ value: path });
  return render(() => (
    <MemoryRouter history={history} root={(p) => <>{p.children}</>}>
      <Route path="/ip-clients/:ipClientId" component={DeviceLayout}>
        <Route path="/actions" component={() => <p>actions content</p>} />
        <Route path="/history" component={() => <p>history content</p>} />
        <Route path="/settings" component={() => <p>settings content</p>} />
      </Route>
    </MemoryRouter>
  ));
}

describe("DeviceLayout", () => {
  it("renders the three device sections as links in a labelled nav", async () => {
    renderAt("/ip-clients/client-1/actions");

    const nav = await screen.findByRole("navigation", { name: /device sections/i });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual(["Actions", "History", "Settings"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/ip-clients/client-1/actions",
      "/ip-clients/client-1/history",
      "/ip-clients/client-1/settings",
    ]);
  });

  it.each([
    ["actions", "Actions", "actions content"],
    ["history", "History", "history content"],
    ["settings", "Settings", "settings content"],
  ])("marks only the %s tab as current and renders its content below", async (path, label, content) => {
    renderAt(`/ip-clients/client-1/${path}`);

    await screen.findByText(content);
    const current = document.querySelectorAll('nav a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe(label);
  });
});
