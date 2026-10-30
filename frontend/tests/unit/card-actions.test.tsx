import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "~/components/ui/button";
import { CardActions } from "~/components/ui/card-actions";

afterEach(cleanup);

function renderBoth() {
  return render(() => (
    <CardActions
      safe={
        <>
          <Button variant="outline">Edit</Button>
          <Button variant="outline">Disable</Button>
        </>
      }
      danger={<Button variant="destructive">Detach</Button>}
    />
  ));
}

describe("CardActions", () => {
  it("puts safe actions before danger actions in separate groups", () => {
    const { container } = renderBoth();

    const groups = Array.from(container.querySelectorAll("[data-actions]"));
    expect(groups.map((g) => g.getAttribute("data-actions"))).toEqual(["safe", "danger"]);
    expect(groups[0].textContent).toBe("EditDisable");
    expect(groups[1].textContent).toBe("Detach");
  });

  it("pushes the danger group to the right and keeps 12px gaps", () => {
    const { container } = renderBoth();

    const danger = container.querySelector('[data-actions="danger"]')!;
    expect(danger.classList.contains("ml-auto")).toBe(true);
    for (const el of [container.firstElementChild!, container.querySelector('[data-actions="safe"]')!, danger]) {
      expect(el.classList.contains("gap-3")).toBe(true);
    }
  });

  it("keeps destructive buttons out of the safe group", () => {
    const { container } = renderBoth();

    const destructive = screen.getByRole("button", { name: "Detach" });
    expect(destructive.className).toContain("bg-destructive");
    expect(container.querySelector('[data-actions="safe"]')!.contains(destructive)).toBe(false);
    expect(container.querySelector('[data-actions="safe"] .bg-destructive')).toBeNull();
  });

  it("renders either group on its own", () => {
    const { container } = render(() => <CardActions danger={<Button variant="destructive">Delete</Button>} />);
    expect(container.querySelector('[data-actions="safe"]')).toBeNull();
    expect(container.querySelector('[data-actions="danger"]')).not.toBeNull();
  });
});
