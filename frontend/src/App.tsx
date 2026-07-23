import { Route, Router, useLocation } from "@solidjs/router";
import { lazy, onMount, Show, type JSX } from "solid-js";
import { isAuthenticated, refreshAuthState, signIn, signOut } from "./services/auth";

const IpClients = lazy(() => import("./pages/IpClients"));
const Actions = lazy(() => import("./pages/Actions"));
const Account = lazy(() => import("./pages/Account"));
const ExecutionHistory = lazy(() => import("./pages/ExecutionHistory"));
const NotificationSettings = lazy(() => import("./pages/NotificationSettings"));
const Callback = lazy(() => import("./pages/Callback"));

function Layout(props: { children?: JSX.Element }) {
  const location = useLocation();

  onMount(() => {
    void refreshAuthState();
  });

  return (
    <div>
      <nav>
        <a href="/ip-clients">IP Clients</a> | <a href="/notifications">Notifications</a> |{" "}
        <a href="/account">Account</a> |{" "}
        <Show when={isAuthenticated()} fallback={<button onClick={() => void signIn()}>Sign in</button>}>
          <button onClick={() => void signOut()}>Sign out</button>
        </Show>
      </nav>
      <Show
        when={isAuthenticated() || location.pathname === "/callback"}
        fallback={<p>Please sign in to continue.</p>}
      >
        {props.children}
      </Show>
    </div>
  );
}

export default function App() {
  return (
    <Router root={Layout}>
      <Route path="/" component={IpClients} />
      <Route path="/ip-clients" component={IpClients} />
      <Route path="/ip-clients/:ipClientId/actions" component={Actions} />
      <Route path="/actions/:actionId/executions" component={ExecutionHistory} />
      <Route path="/notifications" component={NotificationSettings} />
      <Route path="/account" component={Account} />
      <Route path="/callback" component={Callback} />
    </Router>
  );
}
