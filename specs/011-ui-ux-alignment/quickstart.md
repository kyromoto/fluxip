# Quickstart: UI/UX-Angleichung prüfen

## Voraussetzungen

```bash
pnpm install
docker compose up -d postgres redis    # nur für das Backend-Dev-Setup
pnpm run dev:backend                   # :8080
pnpm run dev:frontend                  # :5173
```

Anmeldung läuft über Logto (siehe [docs/development.md](../../docs/development.md)). Für E2E-Tests mit Anmeldung gilt `frontend/tests/e2e/README.md`.

## Automatische Prüfung

```bash
pnpm --filter fluxip-frontend test        # Vitest
pnpm --filter fluxip-frontend lint
pnpm --filter fluxip-frontend test:e2e    # Playwright, 320/360px und Desktop, hell/dunkel
```

Erwartung: alle Tests grün. Die Geometrie-Tests (`touch-targets`, `primary-action`, `responsive`) brauchen den gespeicherten Anmeldezustand, ohne ihn laufen nur die Routen ohne Anmeldung.

## Manuelle Prüfung (Browser, Geräte-Modus)

1. **Navigation (FR-001, FR-002)**: Eine Seite öffnen. Top-Bar zeigt Devices, Credentials, Agents, Notifications. Rechts Kreis mit Personen-Symbol, daneben Abmelden. Kreis anklicken führt zu Account, Kreis ist dort aktiv markiert.
2. **Breadcrumbs und Tabs (FR-003 bis FR-005)**: Ein Gerät öffnen. Breadcrumb `Devices / Gerätename`, darunter Tabs Actions, History, Settings. Zwischen den Tabs wechseln: aktiver Tab wechselt, keine große Überschrift mit dem Tab-Namen.
3. **Haupt-CTA (FR-006, FR-007)**: Auf Devices, Credentials, Agents und Actions bei 1280px: Button oben rechts. Auf 390px: Button schwebend unten rechts, beim Scrollen sichtbar, letzter Inhalt nicht verdeckt. Fenster zwischen 767px und 768px ziehen: Wechsel ohne Neuladen.
4. **Aktionsgruppen (FR-008 bis FR-010)**: Eine Aktion mit Edit, Disable und Detach ansehen. Edit/Disable links, Detach rechts und rot. Fenster auf 320px verkleinern: Detach rutscht in eine eigene Zeile, Abstand mindestens 12px.
5. **Touch-Größe (FR-011)**: Bei 390px per Entwicklerwerkzeugen Buttons, Tabs, Nav-Links, Breadcrumb-Links messen: jeweils mindestens 44x44px. Bei 1280px sieht die Desktop-Darstellung unverändert kompakt aus.
6. **Wizards (FR-012)**: Bei 320px den Geräte-, Aktions-, Agent- und Onboarding-Wizard durchlaufen: kein horizontales Scrollen, Weiter/Zurück/Abbrechen treffbar, Abstand mindestens 12px, bei geöffneter Bildschirmtastatur bleibt die Fußzeile erreichbar.
7. **Helles und dunkles Schema (FR-014)**: Schritte 1 bis 4 in beiden Schemata wiederholen.
8. **Funktionsgleichheit (FR-013)**: Aktion anlegen, deaktivieren, abtrennen, Credential löschen, Agent umbenennen: Verhalten und Texte wie vorher.
