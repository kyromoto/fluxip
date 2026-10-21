import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupResult } from "~/flows/traefik-provider-wizard/SetupResult";
import { TraefikProviderWizard } from "~/flows/traefik-provider-wizard/TraefikProviderWizard";
import type { CreatedProvider } from "~/lib/traefik-providers";
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

const created: CreatedProvider = {
  providerId: "p1",
  name: "Office",
  connectionMode: "agent_initiated",
  agentAddress: "https://agents.example.com/p1",
  token: { tokenId: "t1", value: "fxt_secret-token-value", last4: "alue" },
  setup: {
    startCommand: "FLUXIP_ADDRESS=https://agents.example.com/p1 \\\n  FLUXIP_TOKEN=fxt_secret-token-value \\\n  fluxip-agent run",
    traefikSnippet: "providers:\n  file:\n    directory: /etc/traefik/dynamic\n    watch: true\n",
    notes: ["Remove any hand-written definition of a middleware with the same name."],
  },
};

describe("TraefikProviderWizard", () => {
  it("preselects 'agent connects to FluxIP' and shows 'FluxIP connects to the agent' as not available (US8-1)", async () => {
    render(() => <TraefikProviderWizard onCreated={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.input(screen.getByPlaceholderText("e.g. Office Berlin"), { target: { value: "Office" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const agentMode = screen.getByRole("button", { name: /Agent connects to FluxIP/ });
    expect(agentMode.className).toContain("border-primary");
    const serverMode = screen.getByRole("button", { name: /FluxIP connects to the agent/ });
    expect((serverMode as HTMLButtonElement).disabled).toBe(true);
    expect(serverMode.textContent).toContain("Not yet available");
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("cannot continue without a name and makes no call until the final confirmation", () => {
    render(() => <TraefikProviderWizard onCreated={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(screen.getByPlaceholderText("e.g. Office Berlin"), { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("creates the provider on the last step and hands over the one-time result", async () => {
    mockedApi.post.mockResolvedValueOnce(created);
    const onCreated = vi.fn();
    render(() => <TraefikProviderWizard onCreated={onCreated} onCancel={vi.fn()} />);

    fireEvent.input(screen.getByPlaceholderText("e.g. Office Berlin"), { target: { value: "  Office  " } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(mockedApi.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create provider" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(mockedApi.post).toHaveBeenCalledWith("/traefik-providers", { name: "Office", connectionMode: "agent_initiated" });
  });

  it("cancelling leaves nothing created", () => {
    const onCancel = vi.fn();
    render(() => <TraefikProviderWizard onCreated={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });
});

describe("SetupResult", () => {
  it("shows token, address, start command and Traefik example so no external docs are needed (US1-5)", () => {
    render(() => <SetupResult created={created} onDone={vi.fn()} />);
    expect(screen.getByTestId("agent-token").textContent).toBe("fxt_secret-token-value");
    expect(screen.getByText("https://agents.example.com/p1")).toBeTruthy();
    expect(screen.getByText(/fluxip-agent run/)).toBeTruthy();
    expect(screen.getByText(/watch: true/)).toBeTruthy();
    expect(screen.getByText(/hand-written definition/)).toBeTruthy();
  });

  it("copies the command as a single line", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(() => <SetupResult created={created} onDone={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(copied).not.toContain("\n");
    expect(copied).toContain("FLUXIP_TOKEN=fxt_secret-token-value");
    expect(copied.endsWith("fluxip-agent run")).toBe(true);
  });

  it("leaves via the explicit acknowledgement only", () => {
    const onDone = vi.fn();
    render(() => <SetupResult created={created} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "I have saved the token" }));
    expect(onDone).toHaveBeenCalled();
  });
});
