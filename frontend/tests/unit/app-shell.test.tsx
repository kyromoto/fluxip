import { cleanup, render, screen } from "@solidjs/testing-library";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "~/components/layout/AppShell";

vi.mock("~/services/auth", () => ({ signOut: vi.fn() }));
vi.mock("~/components/layout/Breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("~/components/layout/VersionLabel", () => ({ VersionLabel: () => null }));

afterEach(cleanup);

function renderAt(path: string) {
  const history = createMemoryHistory();
  history.set({ value: path });
  return render(() => (
    <MemoryRouter history={history} root={(p) => <AppShell>{p.children}</AppShell>}>
      <Route path="*" component={() => <p>page</p>} />
    </MemoryRouter>
  ));
}

describe("AppShell top bar", () => {
  it("lists Devices, Credentials, Agents and Notifications in the main navigation", () => {
    renderAt("/ip-clients");

    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent)).toEqual([
      "Devices",
      "Credentials",
      "Agents",
      "Notifications",
    ]);
    expect(nav.querySelector('a[href="/account"]')).toBeNull();
  });

  it("shows the account circle directly left of the unchanged sign-out button", () => {
    renderAt("/ip-clients");

    const account = screen.getByRole("link", { name: "Account" });
    expect(account.getAttribute("href")).toBe("/account");
    const signOut = screen.getByRole("button", { name: "Sign out" });
    expect(account.nextElementSibling).toBe(signOut);
    expect(account.parentElement).toBe(signOut.parentElement);
  });

  it("marks the account circle as the current page on /account", () => {
    renderAt("/account");

    expect(screen.getByRole("link", { name: "Account" }).getAttribute("aria-current")).toBe("page");
  });
});
