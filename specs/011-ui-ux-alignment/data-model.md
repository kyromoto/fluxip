# Data Model: UI/UX-Angleichung

Diese Arbeit ändert keine Daten. Es gibt keine neue Entität, kein neues Feld, keine Migration und keinen persistenten UI-Zustand.

## Abgeleitete Werte (nur Darstellung)

| Wert | Quelle | Regel |
|---|---|---|
| Aktiver Tab | aktueller Pfad | Der Tab, dessen Ziel dem Pfad entspricht, trägt `aria-current="page"`. |
| Gerätename im Breadcrumb | `GET /ip-clients/:id` (bestehend) | Unverändert, mit Rückfall auf die ID bei Fehler. |
