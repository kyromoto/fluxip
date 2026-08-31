import { Logo } from "~/components/brand/Logo";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { signIn } from "~/services/auth";

/** Public route — rendered without the application menu (only protected routes get that, via ProtectedLayout). */
export default function Login() {
  return (
    <div class="flex min-h-screen items-center justify-center px-4">
      <Card class="w-full max-w-sm">
        <CardHeader>
          <Logo size={40} class="mb-2" />
          <CardTitle>Sign in to FluxIP</CardTitle>
          <CardDescription>Continue with your account to manage your devices and actions.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button class="w-full" onClick={() => void signIn()}>
            Sign in
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
