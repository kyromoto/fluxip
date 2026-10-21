import { createSignal, type Component } from "solid-js";
import { Button } from "~/components/ui/button";

/** Copies text to the clipboard and briefly confirms; falls back to a no-op where the clipboard API is unavailable. */
export const CopyButton: Component<{ text: string; label?: string }> = (props) => {
  const [copied, setCopied] = createSignal(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
      {copied() ? "Copied" : (props.label ?? "Copy")}
    </Button>
  );
};
