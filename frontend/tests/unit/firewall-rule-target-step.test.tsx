import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FirewallRuleTargetStep } from "~/flows/action-wizard/steps/FirewallRuleTargetStep";
import type { ActionWizardData } from "~/flows/action-wizard/ActionWizard";
import { api } from "~/services/api";

vi.mock("~/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/services/api")>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function baseData(overrides: Partial<ActionWizardData> = {}): ActionWizardData {
  return {
    type: "hetzner_cloud_firewall_rule_update",
    providerCredentialId: "",
    zone: "",
    recordName: "",
    firewallId: "",
    direction: "in",
    protocol: "tcp",
    port: "",
    description: "",
    ipv4: true,
    ipv6: false,
    ...overrides,
  };
}

describe("FirewallRuleTargetStep", () => {
  it("shows an inline create affordance instead of a dropdown when no matching credentials exist", async () => {
    mockedApi.get.mockResolvedValueOnce({ items: [] });
    const updateData = vi.fn();
    render(() => <FirewallRuleTargetStep data={baseData()} updateData={updateData} />);

    await screen.findByText(/don't have a Hetzner API Token yet/i);
    expect(screen.queryByText("Select a credential…")).toBeNull();
  });

  it("filters the credential dropdown to the hetzner provider, listing matches by name", async () => {
    mockedApi.get.mockResolvedValueOnce({
      items: [
        { credentialId: "cred-a", provider: "hetzner", label: "Hauptaccount" },
        { credentialId: "cred-b", provider: "other-provider", label: "Not Hetzner" },
      ],
    });
    const updateData = vi.fn();
    render(() => <FirewallRuleTargetStep data={baseData()} updateData={updateData} />);

    await screen.findByText("Select a credential…");
    const trigger = document.querySelector('[id$="-trigger"]') as HTMLButtonElement;
    fireEvent.pointerDown(trigger, { pointerId: 1, button: 0 });
    await screen.findByText("Hauptaccount");
    expect(screen.queryByText("Not Hetzner")).toBeNull();
  });

  it("updates firewallId and description as the user types", async () => {
    mockedApi.get.mockResolvedValueOnce({ items: [] });
    const updateData = vi.fn();
    render(() => <FirewallRuleTargetStep data={baseData()} updateData={updateData} />);

    fireEvent.input(screen.getByLabelText("Hetzner firewall ID"), { target: { value: "42" } });
    expect(updateData).toHaveBeenCalledWith({ firewallId: "42" });

    fireEvent.input(screen.getByLabelText("Rule description"), { target: { value: "SSH" } });
    expect(updateData).toHaveBeenCalledWith({ description: "SSH" });
  });

  it("shows the port field for tcp/udp protocols and hides it for protocols without a port", async () => {
    mockedApi.get.mockResolvedValueOnce({ items: [] });
    const { unmount } = render(() => (
      <FirewallRuleTargetStep data={baseData({ protocol: "tcp" })} updateData={vi.fn()} />
    ));
    expect(screen.queryByLabelText("Port")).not.toBeNull();
    unmount();

    mockedApi.get.mockResolvedValueOnce({ items: [] });
    render(() => <FirewallRuleTargetStep data={baseData({ protocol: "icmp" })} updateData={vi.fn()} />);
    expect(screen.queryByLabelText("Port")).toBeNull();
  });
});
