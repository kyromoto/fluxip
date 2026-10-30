import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageHeader } from "~/components/layout/PageHeader";
import { PrimaryAction } from "~/components/layout/PrimaryAction";

afterEach(cleanup);

describe("PrimaryAction", () => {
  it("renders a single button that calls onClick", () => {
    const onClick = vi.fn();
    render(() => <PrimaryAction onClick={onClick}>Add credential</PrimaryAction>);

    const buttons = screen.getAllByRole("button", { name: "Add credential" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("floats at the bottom right below 768px and is marked for the shell", () => {
    render(() => <PrimaryAction>Add</PrimaryAction>);

    const button = screen.getByRole("button", { name: "Add" });
    expect(button.hasAttribute("data-primary-action")).toBe(true);
    for (const cls of ["max-md:fixed", "max-md:right-4", "max-md:z-30", "max-md:h-14"]) {
      expect(button.classList.contains(cls)).toBe(true);
    }
    expect(button.className).toContain("max-md:bottom-[max(1rem,env(safe-area-inset-bottom))]");
    // No desktop-only fixed positioning: from 768px up it stays in the header flow.
    expect(button.classList.contains("fixed")).toBe(false);
  });

  it("can render as a link", () => {
    render(() => (
      <PrimaryAction as="a" href="/somewhere">
        Go
      </PrimaryAction>
    ));
    expect(screen.getByRole("link", { name: "Go" }).getAttribute("href")).toBe("/somewhere");
  });
});

describe("PageHeader", () => {
  it("renders an sr-only h1 and no visible row without children", () => {
    const { container } = render(() => <PageHeader title="Credentials" />);

    const h1 = screen.getByRole("heading", { level: 1, name: "Credentials" });
    expect(h1.classList.contains("sr-only")).toBe(true);
    expect(container.querySelector("div")).toBeNull();
  });

  it("places the primary action in a right-aligned row", () => {
    const { container } = render(() => (
      <PageHeader title="Devices">
        <PrimaryAction>Add a device</PrimaryAction>
      </PageHeader>
    ));

    const row = container.querySelector("div")!;
    expect(row.classList.contains("justify-end")).toBe(true);
    expect(row.contains(screen.getByRole("button", { name: "Add a device" }))).toBe(true);
  });
});
