import { cleanup, render, screen } from "@solidjs/testing-library";
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Breadcrumbs } from "~/components/layout/Breadcrumbs";
import { api } from "~/services/api";

vi.mock("~/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/services/api")>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderAt(path: string) {
  const history = createMemoryHistory();
  history.set({ value: path });
  return render(() => (
    <MemoryRouter history={history} root={(p) => <>{p.children}</>}>
      <Route path="*" component={Breadcrumbs} />
    </MemoryRouter>
  ));
}

describe("Breadcrumbs", () => {
  it("shows a single, non-clickable crumb for a top-level route", async () => {
    renderAt("/ip-clients");

    const page = await screen.findByText("Devices");
    expect(page.tagName).toBe("SPAN");
    expect(page.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector("a")).toBeNull();
  });

  it("resolves the device id in the URL to its label and links the ancestor", async () => {
    mockedApi.get.mockResolvedValueOnce({ ipClientId: "client-1", label: "Living Room Router" });

    renderAt("/ip-clients/client-1/actions");

    expect(mockedApi.get).toHaveBeenCalledWith("/ip-clients/client-1");

    const current = await screen.findByText("Living Room Router");
    expect(current.getAttribute("aria-current")).toBe("page");

    const devicesLink = screen.getByRole("link", { name: "Devices" });
    expect(devicesLink.getAttribute("href")).toBe("/ip-clients");
  });

  it("resolves the device for an execution-history route via its actions, without device id in the URL", async () => {
    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/actions/action-1/executions") {
        return { items: [{ ipClientId: "client-1" }] };
      }
      if (path === "/ip-clients/client-1") {
        return { ipClientId: "client-1", label: "Living Room Router" };
      }
      throw new Error(`unexpected path ${path}`);
    });

    renderAt("/actions/action-1/executions");

    const deviceLink = await screen.findByRole("link", { name: "Living Room Router" });
    expect(deviceLink.getAttribute("href")).toBe("/ip-clients/client-1/actions");

    const current = screen.getByText("Update history");
    expect(current.getAttribute("aria-current")).toBe("page");
  });

  it("falls back gracefully when the device behind an action can't be resolved", async () => {
    mockedApi.get.mockRejectedValue(new Error("not found"));

    renderAt("/actions/action-1/executions");

    const current = await screen.findByText("Update history");
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Devices" }).getAttribute("href")).toBe("/ip-clients");
  });
});
