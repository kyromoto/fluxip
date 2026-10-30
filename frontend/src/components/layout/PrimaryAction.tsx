import { splitProps, type ComponentProps } from "solid-js";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/cn";

/**
 * The page's one primary action (Constitution III.3). A single element with
 * two CSS forms, so there is no second focus target and no viewport script:
 * from 768px up it sits top right inside PageHeader; below that it floats at
 * the bottom right within thumb reach. AppShell reserves bottom padding while
 * one is mounted (matched via data-primary-action).
 */
export function PrimaryAction(props: ComponentProps<typeof Button>) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <Button
      data-primary-action=""
      class={cn(
        "max-md:fixed max-md:bottom-[max(1rem,env(safe-area-inset-bottom))] max-md:right-4 max-md:z-30 max-md:h-14 max-md:min-w-14 max-md:rounded-full max-md:px-6 max-md:shadow-lg",
        local.class,
      )}
      {...others}
    />
  );
}
