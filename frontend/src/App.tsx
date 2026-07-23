import { Route, Router } from "@solidjs/router";
import { lazy } from "solid-js";
import { AppShell } from "./components/layout/AppShell";

const IpClients = lazy(() => import("./pages/IpClients"));
const Actions = lazy(() => import("./pages/Actions"));
const Account = lazy(() => import("./pages/Account"));
const ExecutionHistory = lazy(() => import("./pages/ExecutionHistory"));
const NotificationSettings = lazy(() => import("./pages/NotificationSettings"));
const Callback = lazy(() => import("./pages/Callback"));

export default function App() {
  return (
    <Router root={AppShell}>
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
