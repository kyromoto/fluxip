import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionWizardData } from "~/flows/action-wizard/ActionWizard";
import { TraefikDeliveryStep } from "~/flows/action-wizard/steps/TraefikDeliveryStep";
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

function baseData(overrides: Partial<ActionWizardData> = {}): ActionWizardData {
  return {
    type: "traefik_config_delivery",
    providerCredentialId: "",
    zone: "",
    recordName: "",
    firewallId: "",
    direction: "in",
    protocol: "tcp",
    port: "",
    description: "",
    traefikProviderId: "",
    group: "",
    ipv4: true,
    ipv6: true,
    ...overrides,
  };
}

const provider = (id: string, name: string) => ({ providerId: id, name, state: "connected", actionCount: 0 });

describe("TraefikDeliveryStep", () => {
  it("points to the providers page instead of a dead end when the account has none", async () => {
    mockedApi.get.mockResolvedValueOnce({ items: [] });
    render(() => <TraefikDeliveryStep data={baseData()} updateData={vi.fn()} />);

    await screen.findByText(/don't have a Traefik provider yet/i);
    const link = screen.getByRole("link", { name: /add one first/i });
    expect(link.getAttribute("href")).toBe("/traefik-providers");
    expect(screen.queryByLabelText("Group")).toBeNull();
  });

  it("lists only what the API returns for the account and hides the group until a provider is chosen", async () => {
    mockedApi.get.mockResolvedValueOnce({ items: [provider("p1", "Office"), provider("p2", "Home")] });
    render(() => <TraefikDeliveryStep data={baseData()} updateData={vi.fn()} />);

    await screen.findByText("Select a provider…");
    expect(mockedApi.get).toHaveBeenCalledWith("/traefik-providers");
    expect(screen.queryByLabelText("Group")).toBeNull();
  });

  it("suggests the groups already used by the chosen provider and fills the group on click (US2-1)", async () => {
    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/traefik-providers") return { items: [provider("p1", "Office")] };
      if (path === "/traefik-providers/p1") return { ...provider("p1", "Office"), groups: ["admin-allowlist", "homelab"], usedBy: [] };
      throw new Error(`unexpected ${path}`);
    });
    const updateData = vi.fn();
    render(() => <TraefikDeliveryStep data={baseData({ traefikProviderId: "p1" })} updateData={updateData} />);

    await screen.findByText("Already used:");
    fireEvent.click(await screen.findByRole("button", { name: "homelab" }));
    expect(updateData).toHaveBeenCalledWith({ group: "homelab" });
  });

  it("normalizes typed groups to lowercase and flags malformed ones", async () => {
    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/traefik-providers") return { items: [provider("p1", "Office")] };
      return { ...provider("p1", "Office"), groups: [], usedBy: [] };
    });
    const updateData = vi.fn();
    const { unmount } = render(() => <TraefikDeliveryStep data={baseData({ traefikProviderId: "p1" })} updateData={updateData} />);

    const input = await screen.findByPlaceholderText("e.g. admin-allowlist");
    fireEvent.input(input, { target: { value: "Admin-List" } });
    await waitFor(() => expect(updateData).toHaveBeenCalledWith({ group: "admin-list" }));
    unmount();

    render(() => <TraefikDeliveryStep data={baseData({ traefikProviderId: "p1", group: "Has Space" })} updateData={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/lowercase letters/i);
  });

  it("warns that a name outside the suggestions creates a new group (typo guard)", async () => {
    mockedApi.get.mockImplementation(async (path: string) => {
      if (path === "/traefik-providers") return { items: [provider("p1", "Office")] };
      return { ...provider("p1", "Office"), groups: ["admin-allowlist"], usedBy: [] };
    });
    render(() => <TraefikDeliveryStep data={baseData({ traefikProviderId: "p1", group: "admin-alowlist" })} updateData={vi.fn()} />);

    const input = await screen.findByPlaceholderText("e.g. admin-allowlist");
    fireEvent.focus(input);
    await screen.findByText(/creates a new group/i);
  });
});
