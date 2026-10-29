import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeviceHistory from "~/pages/DeviceHistory";
import { api } from "~/services/api";

vi.mock("@solidjs/router", () => ({ useParams: () => ({ ipClientId: "dev-1" }) }));
vi.mock("~/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/services/api")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), put: vi.fn(), patch: vi.fn() } };
});
const mockedApi = vi.mocked(api);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/** The backend returns oldest first: change #1 is the oldest. */
function changes(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    ipChangedEventId: `e${i + 1}`,
    time: `change-${String(i + 1).padStart(2, "0")}`,
    data: { newIPv4: `203.0.113.${i + 1}` },
    executions: [],
  }));
}

function mockApi(count: number) {
  mockedApi.get.mockImplementation(async (path: string) => {
    if (path === "/ip-clients/dev-1") return { ipClientId: "dev-1", label: "Router" };
    if (path === "/ip-clients/dev-1/history") return { items: changes(count) };
    throw new Error(`unexpected ${path}`);
  });
}

const label = (n: number) => `change-${String(n).padStart(2, "0")}`;
const shownTimes = () => screen.queryAllByText(/^change-\d\d$/).map((el) => el.textContent);

function mockOneChangeWith(statuses: ("running" | "succeeded" | "failed")[]) {
  mockedApi.get.mockImplementation(async (path: string) => {
    if (path === "/ip-clients/dev-1") return { ipClientId: "dev-1", label: "Router" };
    return {
      items: [
        {
          ipChangedEventId: "e1",
          time: "change-01",
          data: { newIPv4: "203.0.113.1" },
          executions: statuses.map((status, i) => ({
            executionId: `x${i}`,
            actionId: `a${i}`,
            action: { type: "hetzner_cloud_dns_update", zone: "example.com", recordName: `host${i}` },
            status,
            attempt: 1,
            error: status === "failed" ? "upstream rejected" : null,
            startedAt: "start",
            completedAt: status === "succeeded" ? `done-${i}` : null,
            failedAt: status === "failed" ? `failed-${i}` : null,
          })),
        },
      ],
    };
  });
}

describe("Device history address change", () => {
  function mockChange(data: Record<string, string>) {
    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/ip-clients/dev-1") return { ipClientId: "dev-1", label: "Router" };
      return { items: [{ ipChangedEventId: "e1", time: "change-01", data, executions: [] }] };
    });
  }

  it("draws a vertically centered arrow between the old and new address", async () => {
    mockChange({ previousIPv4: "203.0.113.1", newIPv4: "203.0.113.2" });
    render(() => <DeviceHistory />);
    await screen.findByText("203.0.113.2");

    const arrow = screen.getByTestId("address-arrow");
    const row = arrow.parentElement!;
    expect(row.className).toContain("items-center");
    expect(arrow.parentElement!.parentElement!.className).toContain("items-center");
    expect([...row.children].map((el) => el.textContent || "arrow")).toEqual(["203.0.113.1", "arrow", "203.0.113.2"]);
    expect(row.getAttribute("title")).toBe("203.0.113.1 → 203.0.113.2");
    expect(screen.queryByText(/→/)).toBeNull();
  });

  it("shows just the address, without an arrow, for a first report", async () => {
    mockChange({ newIPv4: "203.0.113.2" });
    render(() => <DeviceHistory />);
    await screen.findByText("203.0.113.2");
    expect(screen.queryByTestId("address-arrow")).toBeNull();
  });

  it("handles IPv4 and IPv6 changes on separate lines", async () => {
    mockChange({ previousIPv4: "203.0.113.1", newIPv4: "203.0.113.2", previousIPv6: "2001:db8::1", newIPv6: "2001:db8::2" });
    render(() => <DeviceHistory />);
    await screen.findByText("2001:db8::2");
    expect(screen.getAllByTestId("address-arrow")).toHaveLength(2);
    expect(screen.getByText("IPv4")).toBeTruthy();
    expect(screen.getByText("IPv6")).toBeTruthy();
  });
});

describe("Device history status icons", () => {
  it("shows a labelled icon per execution instead of the status text", async () => {
    mockOneChangeWith(["succeeded", "failed", "running"]);
    render(() => <DeviceHistory />);
    await screen.findByText(/host0\.example\.com/);

    const icons = screen.getAllByRole("img");
    expect(icons.map((i) => i.getAttribute("data-status"))).toEqual(["succeeded", "failed", "running"]);
    expect(icons.map((i) => i.getAttribute("title"))).toEqual(["Succeeded", "Failed", "In progress"]);
    expect(icons.map((i) => i.getAttribute("aria-label"))).toEqual(["Succeeded", "Failed", "In progress"]);
    // The words only live in the tooltip now, not as visible text.
    expect(screen.queryByText("Succeeded")).toBeNull();
    expect(screen.queryByText("Failed")).toBeNull();
    expect(screen.queryByText("In progress")).toBeNull();
  });

  it("puts the icon between the date and the action text", async () => {
    mockOneChangeWith(["failed"]);
    render(() => <DeviceHistory />);
    const action = await screen.findByText(/host0\.example\.com/);
    const row = action.closest("li")!;
    const children = [...row.children].map((el) => (el.matches("[role=img]") ? "icon" : (el.textContent ?? "")));
    expect(children[0]).toBe("failed-0");
    expect(children[1]).toBe("icon");
    expect(children[2]).toMatch(/host0\.example\.com/);
  });

  it("colors success green, failure red and running amber", async () => {
    mockOneChangeWith(["succeeded", "failed", "running"]);
    render(() => <DeviceHistory />);
    await screen.findByText(/host0\.example\.com/);
    const colors = screen.getAllByRole("img").map((i) => i.querySelector("svg")!.getAttribute("class")!);
    expect(colors[0]).toContain("text-green-600");
    expect(colors[1]).toContain("text-destructive");
    expect(colors[2]).toContain("text-amber-600");
  });

  it("keeps showing the error reason next to a failed execution", async () => {
    mockOneChangeWith(["failed"]);
    render(() => <DeviceHistory />);
    await screen.findByText(/upstream rejected/);
  });
});

describe("Device history pagination", () => {
  it("shows the newest 10 on page one by default", async () => {
    mockApi(25);
    render(() => <DeviceHistory />);

    await screen.findByText("change-25");
    expect(shownTimes()).toEqual(Array.from({ length: 10 }, (_, i) => label(25 - i)));
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Newer" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("pages towards older entries and back, disabling the buttons at the ends", async () => {
    mockApi(25);
    render(() => <DeviceHistory />);
    await screen.findByText("change-25");

    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    expect(shownTimes()).toEqual(Array.from({ length: 10 }, (_, i) => label(15 - i)));

    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    expect(screen.getByText("Page 3 of 3")).toBeTruthy();
    expect(shownTimes()).toEqual(["change-05", "change-04", "change-03", "change-02", "change-01"]);
    expect((screen.getByRole("button", { name: "Older" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Newer" }));
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
  });

  it("changing the page size returns to page one and uses the new size", async () => {
    mockApi(60);
    render(() => <DeviceHistory />);
    await screen.findByText("change-60");
    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    fireEvent.click(screen.getByRole("button", { name: "Older" }));

    fireEvent.change(screen.getByLabelText("Per page"), { target: { value: "25" } });
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    expect(shownTimes()).toHaveLength(25);
    expect(shownTimes()[0]).toBe("change-60");

    fireEvent.change(screen.getByLabelText("Per page"), { target: { value: "50" } });
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect(shownTimes()).toHaveLength(50);
  });

  it("shows no pagination controls when everything fits on one page", async () => {
    mockApi(10);
    render(() => <DeviceHistory />);
    await screen.findByText("change-10");
    expect(shownTimes()).toHaveLength(10);
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
  });

  it("keeps the empty state for a device without changes", async () => {
    mockApi(0);
    render(() => <DeviceHistory />);
    await screen.findByText(/hasn't reported an address change yet/i);
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
  });

  it("offers 10, 25 and 50 per page", async () => {
    mockApi(30);
    render(() => <DeviceHistory />);
    await screen.findByText("change-30");
    const select = screen.getByLabelText("Per page");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["10", "25", "50"]);
    expect((select as HTMLSelectElement).value).toBe("10");
  });
});

describe("Device history Traefik deliveries", () => {
  const delivery = (overrides: Record<string, unknown> = {}) => ({
    actionId: "t1",
    providerName: "Nord",
    group: "home",
    kind: "delivered",
    stage: "applied",
    at: "at-1",
    error: null,
    ...overrides,
  });

  function mockDeliveries(deliveries: unknown[], executions: unknown[] = []) {
    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/ip-clients/dev-1") return { ipClientId: "dev-1", label: "Router" };
      return { items: [{ ipChangedEventId: "e1", time: "change-01", data: { newIPv4: "203.0.113.1" }, executions, deliveries }] };
    });
  }

  it("shows agent, group, stage and time for each stage, with the failure reason", async () => {
    mockDeliveries([
      delivery({ stage: "published", at: "at-pub", actionId: "t1" }),
      delivery({ stage: "applied", at: "at-app", actionId: "t2", providerName: "Süd", group: "edge" }),
      delivery({ stage: "failed", at: "at-fail", actionId: "t3", providerName: "Ost", group: "lab", error: "template broken" }),
    ]);
    render(() => <DeviceHistory />);
    const rows = await screen.findAllByTestId("delivery-row");

    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("at-pub"),
      expect.stringContaining("at-app"),
      expect.stringContaining("at-fail"),
    ]);
    expect(within(rows[0]!).getByText(/Nord · home/)).toBeTruthy();
    expect(within(rows[0]!).getByText("Published, awaiting agent", { selector: "span:not([role=img])" })).toBeTruthy();
    expect(within(rows[1]!).getByText(/Süd · edge/)).toBeTruthy();
    expect(within(rows[1]!).getByText("Applied", { selector: "span:not([role=img])" })).toBeTruthy();
    expect(within(rows[2]!).getByText(/Ost · lab/)).toBeTruthy();
    expect(within(rows[2]!).getByText("— template broken")).toBeTruthy();
    expect(rows.map((r) => r.querySelector("[role=img]")!.getAttribute("data-status"))).toEqual(["running", "succeeded", "failed"]);
  });

  it("keeps deliveries apart from executions and never calls them executions", async () => {
    mockOneChangeWithDelivery();
    render(() => <DeviceHistory />);
    await screen.findByText(/host0\.example\.com/);

    const rows = screen.getAllByTestId("delivery-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.closest("ul")!.getAttribute("aria-label")).toBe("Traefik deliveries");
    expect(rows[0]!.closest("ul")).not.toBe(screen.getByText(/host0\.example\.com/).closest("ul"));
    expect(rows[0]!.textContent).toContain("Traefik delivery");
    expect(rows[0]!.textContent).not.toMatch(/execution/i);
    // Existing execution icons are unchanged.
    expect(screen.getAllByRole("img").map((i) => i.getAttribute("title"))).toEqual(["Succeeded", "Applied"]);
  });

  function mockOneChangeWithDelivery() {
    mockDeliveries([delivery()], [
      {
        executionId: "x0",
        actionId: "a0",
        action: { type: "hetzner_cloud_dns_update", zone: "example.com", recordName: "host0" },
        status: "succeeded",
        attempt: 1,
        error: null,
        startedAt: "start",
        completedAt: "done-0",
        failedAt: null,
      },
    ]);
  }

  it("explains a change delivered together with a later one, without stage or time", async () => {
    mockDeliveries([delivery({ kind: "combined", stage: null, at: null })]);
    render(() => <DeviceHistory />);
    const row = await screen.findByTestId("delivery-row");
    expect(within(row).getByText("Delivered together with a later change")).toBeTruthy();
    expect(row.querySelector("[role=img]")).toBeNull();
    expect(within(row).getByText(/Nord · home/)).toBeTruthy();
  });

  it("names a deleted agent without failing", async () => {
    mockDeliveries([delivery({ providerName: null })]);
    render(() => <DeviceHistory />);
    const row = await screen.findByTestId("delivery-row");
    expect(within(row).getByText(/Agent no longer exists · home/)).toBeTruthy();
    expect(within(row).getByText("Applied", { selector: "span:not([role=img])" })).toBeTruthy();
  });

  it("shows no delivery rows, and the usual empty note, for a change without deliveries", async () => {
    mockDeliveries([]);
    render(() => <DeviceHistory />);
    await screen.findByText("203.0.113.1");
    expect(screen.queryByTestId("delivery-row")).toBeNull();
    expect(screen.getByText("No Actions were configured for this change.")).toBeTruthy();
  });

  it("copes with a backend that sends no deliveries field", async () => {
    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/ip-clients/dev-1") return { ipClientId: "dev-1", label: "Router" };
      return { items: [{ ipChangedEventId: "e1", time: "change-01", data: { newIPv4: "203.0.113.1" }, executions: [] }] };
    });
    render(() => <DeviceHistory />);
    await screen.findByText("203.0.113.1");
    expect(screen.getByText("No Actions were configured for this change.")).toBeTruthy();
  });
});
