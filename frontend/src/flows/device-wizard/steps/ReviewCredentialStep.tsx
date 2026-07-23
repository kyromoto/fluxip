import type { Component } from "solid-js";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";

export interface ReviewCredentialStepProps {
  username: string;
  password: string;
  onDone: () => void;
}

/**
 * Shown once, right after the device is created — not a wizard step, since
 * the credential doesn't exist until the create call (WizardShell's final
 * step) has actually succeeded.
 */
export const ReviewCredentialStep: Component<ReviewCredentialStepProps> = (props) => {
  return (
    <Card class="mx-auto w-full max-w-lg" role="alert">
      <CardHeader>
        <CardTitle>Save these now</CardTitle>
        <CardDescription>
          This password is shown only once. Configure your router's DynDNS client with these
          values.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-2 text-sm">
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt class="text-muted-foreground">Update URL</dt>
          <dd class="font-mono">/nic/update?hostname=fluxip&amp;myip=&lt;ipaddr&gt;</dd>
          <dt class="text-muted-foreground">Username</dt>
          <dd class="font-mono">{props.username}</dd>
          <dt class="text-muted-foreground">Password</dt>
          <dd class="font-mono">{props.password}</dd>
        </dl>
      </CardContent>
      <CardFooter>
        <Button onClick={() => props.onDone()}>Done, I've saved it</Button>
      </CardFooter>
    </Card>
  );
};
