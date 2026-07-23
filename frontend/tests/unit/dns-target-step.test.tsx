import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DnsTargetStep } from "~/flows/action-wizard/steps/DnsTargetStep";
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
    type: "update_dns_record",
    providerCredentialId: "",
    zone: "zone-123",
    recordName: "home.example.com",
    ipv4: true,
    ipv6: false,
    ...overrides,
  };
}

describe("DnsTargetStep", () => {
  it("shows an inline create affordance instead of a dropdown when no matching credentials exist", async () => {
    mockedApi.get.mockResolvedValueOnce({ items: [] });
    const updateData = vi.fn();
    render(() => <DnsTargetStep data={baseData()} updateData={updateData} />);

    await screen.findByText(/don't have a Hetzner API Token yet/i);
    expect(screen.queryByText("Select a credential…")).toBeNull();
  });

  it("creating a credential inline auto-selects it and preserves the rest of the wizard data", async () => {
    mockedApi.get.mockResolvedValueOnce({ items: [] });
    const updateData = vi.fn();
    render(() => <DnsTargetStep data={baseData()} updateData={updateData} />);

    await screen.findByText(/don't have a Hetzner API Token yet/i);

    mockedApi.post.mockResolvedValueOnce({
      credentialId: "cred-new",
      provider: "hetzner",
      label: "Hetzner Hauptaccount",
      secretLast4: "9999",
    });
    mockedApi.get.mockResolvedValueOnce({
      items: [{ credentialId: "cred-new", provider: "hetzner", label: "Hetzner Hauptaccount" }],
    });

    fireEvent.click(screen.getByText("Add one now"));
    fireEvent.input(screen.getByPlaceholderText(/hetzner hauptaccount/i), { target: { value: "Hetzner Hauptaccount" } });
    const secretInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(secretInput, { target: { value: "s3cr3t-9999" } });
    fireEvent.click(screen.getByText("Add credential"));

    await waitFor(() => expect(updateData).toHaveBeenCalledWith({ providerCredentialId: "cred-new" }));
  });

  it("cancelling the inline create dialog leaves the wizard step unchanged", async () => {
    mockedApi.get.mockResolvedValueOnce({ items: [] });
    const updateData = vi.fn();
    render(() => <DnsTargetStep data={baseData()} updateData={updateData} />);

    await screen.findByText(/don't have a Hetzner API Token yet/i);

    fireEvent.click(screen.getByText("Add one now"));
    await screen.findByText("Add a credential");
    fireEvent.click(screen.getByText("Cancel"));

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(updateData).not.toHaveBeenCalled();
  });

  it("lists existing matching credentials by name in the dropdown", async () => {
    mockedApi.get.mockResolvedValueOnce({
      items: [
        { credentialId: "cred-a", provider: "hetzner", label: "Hauptaccount" },
        { credentialId: "cred-b", provider: "hetzner", label: "Kundenprojekt X" },
      ],
    });
    const updateData = vi.fn();
    render(() => <DnsTargetStep data={baseData()} updateData={updateData} />);

    await screen.findByText("Select a credential…");
    const trigger = document.querySelector('[id$="-trigger"]') as HTMLButtonElement;
    fireEvent.pointerDown(trigger, { pointerId: 1, button: 0 });
    await screen.findByText("Hauptaccount");
    screen.getByText("Kundenprojekt X");
  });
});
