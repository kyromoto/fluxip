import type { Component } from "solid-js";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { toUserMessage } from "~/lib/errors";

interface ErrorMessageProps {
  error: unknown;
}

/**
 * Renders only the plain-language mapping of a caught error (FR-013/014/015;
 * contracts/error-message-catalog.md) — never a raw `.message`/`String(err)`.
 */
export const ErrorMessage: Component<ErrorMessageProps> = (props) => {
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{toUserMessage(props.error)}</AlertDescription>
    </Alert>
  );
};
