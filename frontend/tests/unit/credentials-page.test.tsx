import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import Credentials from "~/pages/Credentials";
import { api, ApiError } from "~/services/api";

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

describe("Credentials page", () => {
  it("shows the empty state, then creates a credential and lists it masked", async () => {
    mockedApi.get.mockResolvedValueOnce({ items: [] });
    render(() => <Credentials />);

    await screen.findByText(/haven't added any credentials yet/i);

    mockedApi.post.mockResolvedValueOnce({
      credentialId: "cred-1",
      provider: "hetzner",
      label: "Hetzner Hauptaccount",
      secretLast4: "9999",
    });
    mockedApi.get.mockResolvedValueOnce({
      items: [{ credentialId: "cred-1", provider: "hetzner", label: "Hetzner Hauptaccount", secretLast4: "9999" }],
    });

    fireEvent.click(screen.getByText("Add your first credential"));
    const form = document.querySelector("form") as HTMLFormElement;
    fireEvent.input(screen.getByPlaceholderText(/hetzner hauptaccount/i), { target: { value: "Hetzner Hauptaccount" } });
    const secretInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(secretInput, { target: { value: "s3cr3t-token-9999" } });
    fireEvent.click(within(form).getByText("Add credential"));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/provider-credentials", {
      provider: "hetzner",
      label: "Hetzner Hauptaccount",
      secret: "s3cr3t-token-9999",
    }));

    await screen.findByText("Hetzner Hauptaccount");
    screen.getByText("••••9999");
    expect(document.body.textContent).not.toContain("s3cr3t-token-9999");
  });

  it("deletes a credential and removes it from the list", async () => {
    mockedApi.get.mockResolvedValueOnce({
      items: [{ credentialId: "cred-1", provider: "hetzner", label: "Hauptaccount", secretLast4: "1234" }],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(() => <Credentials />);

    await screen.findByText("Hauptaccount");

    mockedApi.delete.mockResolvedValueOnce(undefined);
    mockedApi.get.mockResolvedValueOnce({ items: [] });

    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/provider-credentials/cred-1"));
    await screen.findByText(/haven't added any credentials yet/i);
  });

  it("renders a plain-language error when delete fails for an unrelated reason", async () => {
    mockedApi.get.mockResolvedValueOnce({
      items: [{ credentialId: "cred-1", provider: "hetzner", label: "Hauptaccount", secretLast4: "1234" }],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(() => <Credentials />);

    await screen.findByText("Hauptaccount");

    mockedApi.delete.mockRejectedValueOnce(new ApiError(500, JSON.stringify({ error: "internal error" })));

    fireEvent.click(screen.getByText("Delete"));

    await screen.findByRole("alert");
  });

  it("names the specific referencing Actions when a delete is blocked (FR-010, US3)", async () => {
    mockedApi.get.mockResolvedValueOnce({
      items: [{ credentialId: "cred-1", provider: "hetzner", label: "Hauptaccount", secretLast4: "1234" }],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(() => <Credentials />);

    await screen.findByText("Hauptaccount");

    mockedApi.delete.mockRejectedValueOnce(
      new ApiError(
        409,
        JSON.stringify({
          error: "credential_in_use",
          usedBy: [{ actionId: "action-1", ipClientId: "client-1", zone: "zone1", recordName: "home.example.com" }],
        }),
      ),
    );

    fireEvent.click(screen.getByText("Delete"));

    await screen.findByText(/home\.example\.com/);
    expect(screen.getByRole("link", { name: /view this device's actions/i }).getAttribute("href")).toBe(
      "/ip-clients/client-1/actions",
    );
  });
});
