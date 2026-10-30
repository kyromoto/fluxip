import { Route, Router } from "@solidjs/router";
import { lazy } from "solid-js";
import { DeviceLayout } from "./components/layout/DeviceLayout";
import { ProtectedLayout } from "./components/layout/ProtectedLayout";

const IpClients = lazy(() => import("./pages/IpClients"));
const DeviceHistory = lazy(() => import("./pages/DeviceHistory"));
const DeviceSettings = lazy(() => import("./pages/DeviceSettings"));
const Actions = lazy(() => import("./pages/Actions"));
const Credentials = lazy(() => import("./pages/Credentials"));
const TraefikProviders = lazy(() => import("./pages/TraefikProviders"));
const Account = lazy(() => import("./pages/Account"));
const ExecutionHistory = lazy(() => import("./pages/ExecutionHistory"));
const NotificationSettings = lazy(() => import("./pages/NotificationSettings"));
const Login = lazy(() => import("./pages/Login"));
const Callback = lazy(() => import("./pages/Callback"));

export default function App() {
  return (
    <Router>
      {/* Public routes — no menu, no auth check. */}
      <Route path="/login" component={Login} />
      <Route path="/callback" component={Callback} />

      {/* Protected routes — ProtectedLayout gates on auth status and renders the menu. */}
      <Route path="/" component={ProtectedLayout}>
        <Route path="/" component={IpClients} />
        <Route path="/ip-clients" component={IpClients} />
        <Route path="/ip-clients/:ipClientId" component={DeviceLayout}>
          <Route path="/actions" component={Actions} />
          <Route path="/history" component={DeviceHistory} />
          <Route path="/settings" component={DeviceSettings} />
        </Route>
        <Route path="/actions/:actionId/executions" component={ExecutionHistory} />
        <Route path="/credentials" component={Credentials} />
        <Route path="/agents" component={TraefikProviders} />
        <Route path="/notifications" component={NotificationSettings} />
        <Route path="/account" component={Account} />
      </Route>
    </Router>
  );
}
