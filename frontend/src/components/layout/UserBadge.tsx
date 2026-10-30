import { A } from "@solidjs/router";

/**
 * Link to the account page, shown as a circle left of the sign-out button.
 * Neutral person icon for now; initials or an avatar will fill the same
 * circle later (docs/backlog.md), so size, position and target stay put.
 */
export function UserBadge() {
  return (
    <A
      href="/account"
      aria-label="Account"
      class="touch-target inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-input text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground max-md:size-11"
      activeClass="border-primary text-foreground"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="size-5"
        aria-hidden="true"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
      </svg>
    </A>
  );
}
