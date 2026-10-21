import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatVersion, VersionLabel } from "~/components/layout/VersionLabel";
import { api } from "~/services/api";

vi.mock("~/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/services/api")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), put: vi.fn(), patch: vi.fn() } };
});
const mockedApi = vi.mocked(api);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("formatVersion", () => {
  it("prefixes real versions with v and leaves 'dev' alone", () => {
    expect(formatVersion("1.4.2")).toBe("v1.4.2");
    expect(formatVersion("0.1.0")).toBe("v0.1.0");
    expect(formatVersion("dev")).toBe("dev");
  });
});

describe("VersionLabel", () => {
  it("shows the version the backend reports", async () => {
    mockedApi.get.mockResolvedValueOnce({ version: "1.4.2" });
    render(() => <VersionLabel />);
    expect((await screen.findByTestId("app-version")).textContent).toBe("v1.4.2");
    expect(mockedApi.get).toHaveBeenCalledWith("/version");
  });

  it("shows nothing, and no error, when the version can't be fetched", async () => {
    mockedApi.get.mockRejectedValueOnce(new Error("offline"));
    render(() => <VersionLabel />);
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalled());
    expect(screen.queryByTestId("app-version")).toBeNull();
  });
});
