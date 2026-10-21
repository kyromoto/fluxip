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
