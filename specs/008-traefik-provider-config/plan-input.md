# Technische Vorentscheidungen für /speckit-plan

Diese Punkte gehören nicht in die Spezifikation (`spec.md`), sondern sind Eingabe für die Planungsphase.

- **Agent-Sprache**: Go, statisch gelinkt (`CGO_ENABLED=0`), Cross-Compile für linux/amd64 und linux/arm64. Das `.proto` wird im Monorepo geteilt, Code wird nicht geteilt.
- **Transport und Sitzung**: gRPC mit einem bidirektionalen Stream als Sitzung. Alle Nachrichten (Hello, Snapshot, Anwendungsbericht, Lebenszeichen) laufen über denselben Nachrichtentyp mit `oneof`, und beide Seiten implementieren denselben Handler. Dadurch ist der Nachrichtenfluss unabhängig vom Initiator. Variante A ist FluxIP als gRPC-Server und Agent als Client. Variante B wäre derselbe Dienst mit vertauschten Rollen.
- **Architektur in FluxIP**: Ein Port für die Agent-Sitzung (hexagonal, pragmatisch) mit einem Adapter für eingehende Agent-Verbindungen. Ein Adapter für ausgehende Verbindungen zu Agents (Variante B) wird später ergänzt, ohne Domäne und Sitzungslogik zu ändern.
- **Agent-Adresse**: Im Plan klären, ob die Konfiguration über eine Kennung in Adresse oder Metadaten oder allein über das Token aufgelöst wird, und wie das mit dem Routing durch den vorgeschalteten Traefik (Router mit h2c-Backend, Idle-Timeouts des Entrypoints) zusammenpasst.
- **Authentifizierung**: Token in den gRPC-Metadaten über das TLS des vorgeschalteten Traefik. Für Variante B später gegenseitige Authentifizierung (z. B. mTLS) festlegen.
- **Vorlagen**: Go `text/template` mit eigenen Hilfsfunktionen. Die Dateiendung des Ergebnisses bestimmt die Validierung (YAML, TOML).
- **Schreibziel**: Verzeichnis des Traefik File Providers, Dateien mit konfigurierbarem Präfix, sonst unangetastet.
- **Konsistenz mit Event Sourcing**: Snapshots dürfen aus einer verwerfbaren Redis-Projektion stammen. Die Version sollte an die Position im Ereignisstrom gekoppelt sein, damit Reihenfolge und Wiederaufbau eindeutig sind. Ob die Auslieferung als "Entscheidung" im Sinne der Replay-Regel gilt, ist im Plan zu klären. (Hinweis: siehe auch Memory-Eintrag zur Redis-Actions-Projektion.)
- **Logging**: Backend mit logtape, Korrelations-ID als durchgängiges Merkmal.
- **Release**: GitHub-Actions-Pipeline, SemVer über Conventional Commits, Binaries als Release-Assets, optional ein minimales Image auf GHCR.
- **Namen**: Entities und Ereignisse werden vorgeschlagen und einzeln bestätigt.
