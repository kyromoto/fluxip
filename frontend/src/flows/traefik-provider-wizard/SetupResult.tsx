import { For, type Component } from "solid-js";
import { CopyButton } from "~/components/feedback/CopyButton";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import type { CreatedProvider } from "~/lib/traefik-providers";

/** The one-time result screen: token, address, start command and Traefik example (US1-1, US1-5). */
export const SetupResult: Component<{ created: CreatedProvider; onDone: () => void; heading?: string }> = (props) => (
  <Card class="mx-auto w-full max-w-2xl">
    <CardHeader>
      <CardTitle>{props.heading ?? "Your agent is ready to start"}</CardTitle>
    </CardHeader>
    <CardContent class="space-y-5 text-sm">
      <section class="space-y-1">
        <h3 class="font-medium">1. Token (shown only once)</h3>
        <div class="flex items-center gap-2">
          <code class="flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs" data-testid="agent-token">
            {props.created.token.value}
          </code>
          <CopyButton text={props.created.token.value} />
        </div>
        <p class="text-muted-foreground">Store it somewhere safe. FluxIP keeps only a fingerprint and cannot show it again.</p>
      </section>

      <section class="space-y-1">
        <h3 class="font-medium">2. Agent address</h3>
        <div class="flex items-center gap-2">
          <code class="flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs">{props.created.agentAddress}</code>
          <CopyButton text={props.created.agentAddress} />
        </div>
      </section>

      <section class="space-y-1">
        <h3 class="font-medium">3. Start the agent next to Traefik</h3>
        <pre class="overflow-x-auto rounded bg-muted p-3 font-mono text-xs">{props.created.setup.startCommand}</pre>
        <CopyButton text={props.created.setup.startCommand.replace(/ \\\n {2}/g, " ")} label="Copy command" />
        <p class="text-muted-foreground">
          Get the example templates with <code>fluxip-agent templates --write /etc/fluxip-agent/templates</code> and adapt
          them.
        </p>
      </section>

      <section class="space-y-1">
        <h3 class="font-medium">4. Let Traefik read the generated files</h3>
        <pre class="overflow-x-auto rounded bg-muted p-3 font-mono text-xs">{props.created.setup.traefikSnippet}</pre>
        <CopyButton text={props.created.setup.traefikSnippet} label="Copy snippet" />
      </section>

      <section class="space-y-1">
        <h3 class="font-medium">Good to know</h3>
        <ul class="list-disc space-y-1 pl-5 text-muted-foreground">
          <For each={props.created.setup.notes}>{(note) => <li>{note}</li>}</For>
        </ul>
      </section>
    </CardContent>
    <CardFooter class="justify-end">
      <Button onClick={() => props.onDone()}>I have saved the token</Button>
    </CardFooter>
  </Card>
);
