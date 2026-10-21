import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TraefikProviderSummary } from "~/lib/traefik-providers";
import TraefikProviders from "~/pages/TraefikProviders";
import { api, ApiError } from "~/services/api";

vi.mock("~/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/services/api")>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), put: vi.fn(), patch: vi.fn() } };
});
const mockedApi = vi.mocked(api);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function provider(overrides: Partial<TraefikProviderSummary> = {}): TraefikProviderSummary {
  return {
    providerId: "p1",
    name: "Office",
    connectionMode: "agent_initiated",
    agentAddress: "https://agents.example.com/p1",
    state: "connected",
    lastConnectedAt: "2026-01-01T10:00:00Z",
    lastDisconnectedAt: null,
    appliedVersion: 7,
    publishedVersion: 7,
    agentVersion: "1.2.0",
    lastError: null,
    lastPublishError: null,
    notices: [],
    tokens: [{ tokenId: "t1", last4: "ab12", issuedAt: "2026-01-01T09:00:00Z", status: "valid" }],
    actionCount: 2,
    ...overrides,
  };
}

describe("Traefik providers page", () => {
  it("shows the empty state with a way to add the first provider", async () => {
    mockedApi.get.mockResolvedValueOnce({ items: [] });
    render(() => <TraefikProviders />);
    await screen.findByText(/haven't added a Traefik provider yet/i);
    expect(screen.getByRole("button", { name: "Add your first provider" })).toBeTruthy();
  });

  it("shows state, last connection, applied version and agent version per provider (US6-1)", async () => {
    mockedApi.get.mockResolvedValueOnce({
      items: [
        provider(),
        provider({ providerId: "p2", name: "Home", state: "stale", appliedVersion: 3, publishedVersion: 5, agentVersion: null }),
        provider({ providerId: "p3", name: "Cabin", state: "never_connected", lastConnectedAt: null, appliedVersion: null, publishedVersion: null, agentVersion: null }),
      ],
    });
    render(() => <TraefikProviders />);

    await screen.findByText("Office");
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Stale")).toBeTruthy();
    expect(screen.getByText("Never connected")).toBeTruthy();
    expect(screen.getByText("1.2.0")).toBeTruthy();
    expect(screen.getByText(/latest 5/)).toBeTruthy();
  });

  it("shows why the last version could not be applied (US6-3)", async () => {
    mockedApi.get.mockResolvedValueOnce({
      items: [provider({ lastError: { version: 8, reason: "template allowlist.yml.tmpl: invalid YAML", at: "2026-01-01T10:00:00Z" } })],
    });
    render(() => <TraefikProviders />);
    expect((await screen.findByRole("alert")).textContent).toContain("template allowlist.yml.tmpl: invalid YAML");
  });

  it("tells the user when data is too large to send", async () => {
    mockedApi.get.mockResolvedValueOnce({ items: [provider({ lastPublishError: { reason: "too_large", at: "t" } })] });
    render(() => <TraefikProviders />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/too large/i);
  });

  it("shows the notice when a second agent replaced the first", async () => {
    mockedApi.get.mockResolvedValueOnce({ items: [provider({ notices: ["previous_session_superseded"] })] });
    render(() => <TraefikProviders />);
    await screen.findByText(/first one was disconnected/i);
  });

  it("lists the blocking actions instead of deleting a provider that is in use (US7-3)", async () => {
    mockedApi.get.mockResolvedValue({ items: [provider()] });
    vi.stubGlobal("confirm", vi.fn(() => true));
    mockedApi.delete.mockRejectedValueOnce(
      new ApiError(409, JSON.stringify({ error: "traefik_provider_in_use", usedBy: [{ actionId: "a1", ipClientId: "d1", group: "admin-allowlist" }] })),
    );
    render(() => <TraefikProviders />);

    await screen.findByText("Office");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("still used by 1 action");
    expect(within(alert).getByText("admin-allowlist")).toBeTruthy();
    expect(within(alert).getByRole("link", { name: /view this device's actions/i }).getAttribute("href")).toBe("/ip-clients/d1/actions");
  });

  it("revokes a token only after confirmation", async () => {
    mockedApi.get.mockResolvedValue({ items: [provider()] });
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmMock);
    render(() => <TraefikProviders />);

    await screen.findByText("Office");
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(confirmMock).toHaveBeenCalled();
    expect(mockedApi.delete).not.toHaveBeenCalled();

    confirmMock.mockReturnValue(true);
    mockedApi.delete.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/traefik-providers/p1/tokens/t1"));
  });

  it("shows a new token once and says both tokens work meanwhile (US7-1)", async () => {
    mockedApi.get.mockResolvedValue({ items: [provider()] });
    mockedApi.post.mockResolvedValueOnce({ tokenId: "t2", value: "fxt_new-token-value", last4: "alue" });
    render(() => <TraefikProviders />);

    await screen.findByText("Office");
    fireEvent.click(screen.getByRole("button", { name: "New token" }));
    await screen.findByText("fxt_new-token-value");
    expect(screen.getByText(/old and the new token work/i)).toBeTruthy();
    expect(mockedApi.post).toHaveBeenCalledWith("/traefik-providers/p1/tokens");
  });
});
