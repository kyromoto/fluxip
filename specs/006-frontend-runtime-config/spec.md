# Feature Specification: Frontend Runtime Configuration

**Feature Branch**: `[006-frontend-runtime-config]`

**Created**: 2026-07-24

**Status**: Draft

**Input**: User description: "Das Frontend wird aktuell mit dem npm-Paket \"serve\" ausgeliefert. Das allein reicht nicht aus, weil Vite Umgebungsvariablen zur Build-Zeit fest in den JS-Code einkompiliert, eine Konfiguration zur Laufzeit über Docker-Umgebungsvariablen ist damit nicht möglich. Ergänze einen Mechanismus für Laufzeit-Konfiguration: Ein Entrypoint-Skript im Docker-Image generiert beim Containerstart eine config.js im Frontend-Build-Verzeichnis, die die relevanten Umgebungsvariablen (z.B. Logto-Konfiguration, Backend-URL) als window.__ENV__-Objekt bereitstellt. index.html bindet diese config.js vor dem Haupt-Bundle ein. Der Frontend-Code liest diese Werte über window.__ENV__ statt über import.meta.env, für alles, was sich zwischen Deployments unterscheiden können muss. \"serve\" wird weiterhin im Single-Page-App-Modus (--single) für das SPA-Fallback-Routing verwendet."

## Clarifications

### Session 2026-07-24

- Q: When the backend URL runtime variable is not set, what should happen (today the frontend calls the backend via a same-origin relative path)? → A: Always required — every deployment must set it explicitly; if omitted, treated like any other missing required value (warning surfaced per FR-008), with no same-origin fallback default.
- Q: What guarantees SC-002 ("100% of subsequent page loads reflect the new values" after a restart) against browser/proxy caching of the generated runtime configuration? → A: Caching is allowed, but each container start must be distinguishable (cache-busted) so new page loads after a restart bypass stale cached copies; an already-open tab that isn't reloaded is not required to update automatically.
- Q: Should the runtime-configuration mechanism (window.__ENV__) also work for local development outside the Docker image? → A: No — strictly a Docker/production concern; local development continues using its existing build-time configuration approach, unaffected by this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deploy the same image to a new environment without rebuilding (Priority: P1)

An operator deploys the pre-built FluxIP container image to a new environment (e.g. staging, a customer's environment, or a new tenant deployment) that has its own identity-provider settings and backend location. They set environment variables on the container and start it, without triggering a new frontend build.

**Why this priority**: This is the core problem the feature exists to solve — today, every environment-specific value is baked in at build time, so a new environment requires a new build and image. Without this, the feature delivers no value at all.

**Independent Test**: Start the existing built container image with a set of environment variables pointing at a different identity provider and backend than the ones used at build time, and confirm the running application uses the new values (e.g. the sign-in flow redirects to the new identity provider) rather than the build-time defaults.

**Acceptance Scenarios**:

1. **Given** a built frontend container image and a set of deployment-specific configuration values supplied as environment variables, **When** the container starts, **Then** the running application uses those values for everything that must vary per deployment (identity-provider connection details, backend location).
2. **Given** a container that was already started once with one set of configuration values, **When** it is stopped and restarted with different environment variables (no rebuild), **Then** the application reflects the new values.
3. **Given** the container has finished starting, **When** a user loads the application in a browser, **Then** the page functions correctly (styling, routing, and scripts all load) and reflects the supplied configuration.

---

### User Story 2 - Deep-link into the single-page app still works (Priority: P2)

A user opens a bookmarked or shared URL for a specific in-app page (not the root URL) directly in their browser, or refreshes the browser on such a page.

**Why this priority**: This is existing behavior that must not regress while the runtime-configuration mechanism is introduced. It's independently testable and important, but secondary to the core configuration capability.

**Independent Test**: Deploy the container, navigate directly (via a fresh browser request, e.g. typing/loading the URL rather than in-app navigation) to a deep, non-root application route, and confirm the application loads correctly instead of returning a not-found response.

**Acceptance Scenarios**:

1. **Given** a running deployment, **When** a user requests a non-root application URL directly, **Then** the server returns the application shell so client-side routing can take over, instead of a 404.
2. **Given** a running deployment, **When** a user requests a static build asset (e.g. a JS or CSS file) by its exact path, **Then** that exact asset is returned unchanged.

---

### User Story 3 - Missing or incomplete runtime configuration is easy to diagnose (Priority: P3)

An operator misconfigures or forgets to set one of the required environment variables when starting the container.

**Why this priority**: Improves operability and reduces support burden, but the feature is still usable without this — operators can eventually find the problem through other means. Lowest priority.

**Independent Test**: Start the container with a required configuration value omitted, then confirm the resulting behavior is a clear, discoverable indication of the missing value rather than a silent failure or an opaque error deep in the UI.

**Acceptance Scenarios**:

1. **Given** the container is started without one of the required deployment-specific values set, **When** the container starts, **Then** the application still starts serving (it does not crash the container), and the missing value is surfaced in a way an operator can discover (e.g. at startup and/or when the affected feature is used).

---

### Edge Cases

- What happens when an environment variable value itself contains characters that could break the generated configuration (e.g. quotes, backslashes, HTML-special characters)? The generated configuration must remain valid and must not allow injected script content.
- What happens if the container is restarted with no configuration changes at all? Behavior must be identical to before the restart.
- What happens if a browser or intermediary caches the generated runtime configuration across a restart with new values? Each container start must be distinguishable so that page loads occurring after the restart fetch the current configuration rather than a stale cached copy; a tab left open from before the restart is not required to update until it is reloaded.
- What happens when the application is loaded before the runtime configuration has been made available to the page? The application must not run with undefined configuration values silently treated as valid.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow the deployment-specific values the frontend needs (at minimum: identity-provider connection details and the backend location) to be supplied at container start time via environment variables, without requiring the frontend to be rebuilt. The backend location MUST be treated as a required value for every deployment (no same-origin or other implicit default); if it is not supplied, it is subject to FR-008 like any other missing required value.
- **FR-002**: The system MUST make the currently-effective deployment-specific configuration available to the running frontend application at the time it starts executing in the browser, before any application logic that depends on those values runs.
- **FR-003**: The frontend application code MUST obtain every value that can differ between deployments from the runtime-supplied configuration rather than from a value fixed at build time.
- **FR-004**: Values that are the same across all deployments (i.e. do not need to vary per environment) MAY continue to be fixed at build time and are out of scope for the runtime mechanism.
- **FR-005**: The system MUST continue to serve the single-page application such that direct requests to any in-app route return the application shell (SPA fallback routing), while requests for existing static build assets return those assets directly.
- **FR-006**: Regenerating the deployment-specific configuration MUST happen automatically every time the container starts, reflecting whatever environment variables are present at that start — no manual step required.
- **FR-007**: The generated configuration MUST NOT be exploitable as an injection point: values sourced from environment variables MUST be safely encoded such that they cannot be used to inject or execute unintended script content in the page.
- **FR-008**: If a deployment-specific value is not supplied, the system MUST NOT fail silently with an undefined/empty value being treated as valid configuration; the gap MUST be observable (e.g., a clear warning at startup and/or a clear failure mode for the specific feature that needs the missing value), consistent with how the existing build-time configuration already warns when values are missing.
- **FR-009**: The mechanism MUST NOT require any change to how the container image is built or how the application is compiled for different environments — the same built image must be deployable to multiple environments by varying only its runtime environment variables.
- **FR-010**: The system MUST ensure that a page load occurring after a container restart with different environment variables retrieves the current configuration rather than a stale cached copy from before the restart (e.g. by making each container start distinguishable to caches). A browser tab already open from before the restart is not required to reflect the new values until it is reloaded.
- **FR-011**: This runtime-configuration mechanism applies to the built Docker image only; local development (running the frontend outside the Docker image) is out of scope and continues using its existing build-time configuration approach.

### Key Entities

- **Deployment Configuration**: The set of deployment-specific values the running frontend needs — at minimum, identity-provider connection details (endpoint, application identifier, API resource identifier) and the backend location. Sourced from environment variables at container start; not persisted anywhere other than being exposed to the running frontend for the lifetime of that container.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can point the same, unmodified container image at a different identity provider or backend by changing only environment variables and restarting the container — no image rebuild step is involved.
- **SC-002**: After changing the deployment-specific environment variables and restarting the container, 100% of page loads that occur after the restart (fresh loads or reloads) reflect the new values; no stale build-time or pre-restart values are observed once a page has been (re)loaded.
- **SC-003**: Direct navigation or refresh on any in-app URL continues to succeed (returns the application, not an error page) in 100% of cases, matching current behavior.
- **SC-004**: An operator who omits a required deployment-specific value can identify which value is missing without needing to inspect the frontend's compiled source code.

## Assumptions

- "Deployment-specific values" in scope for this feature are the identity-provider (Logto) connection details and the backend location, matching the values explicitly called out in the request; the mechanism itself is generic enough to extend to further values later without being redesigned.
- The application currently reaches its backend via a same-origin relative path; per clarification, the backend location is nonetheless always a required runtime value going forward (see FR-001) — every deployment, including same-origin ones, must set it explicitly rather than relying on an implicit default.
- Only one frontend container/build artifact is produced per release; the same artifact is reused unmodified across environments, with only the runtime environment variables differing.
- Environment variables are the mechanism by which operators supply deployment-specific values, consistent with how the rest of the system (e.g. the backend) is already configured in this project's deployment model.
- The existing behavior of warning when a required configuration value is absent (currently done at build time in the frontend) is expected to carry over conceptually to the runtime mechanism, rather than being dropped.
- Local development (running the frontend directly, outside the Docker image) is out of scope for this feature per clarification (FR-011) and is unaffected by this mechanism.
