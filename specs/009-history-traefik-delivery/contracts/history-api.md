# Contract: `GET /api/ip-clients/{id}/history`

Erweiterung des bestehenden Endpunkts (001 `contracts/management-api.md`). Bestehende Felder bleiben unverändert (Spec SC-005, FR-011).

## Antwort

```jsonc
{
  "items": [
    {
      "ipChangedEventId": "…",
      "time": "…",
      "data": { "previousIPv4": "…", "newIPv4": "…" },
      "executions": [ /* unverändert: nur DNS und Firewall */ ],
      "deliveries": [            // NEU, immer vorhanden, leer ohne Traefik-Aktionen
        {
          "actionId": "…",
          "traefikProviderId": "…",
          "providerName": "Berlin-Edge",     // null, wenn der Agent nicht mehr existiert
          "group": "home",
          "kind": "delivered",                // "delivered" | "combined"
          "stage": "applied",                 // "published" | "applied" | "failed"; bei "combined" nicht gesetzt (null)
          "at": "2026-10-29T10:00:03.000Z",   // Zeit der Stufe; bei "combined" null
          "error": null,                      // Ursache bei stage = "failed"
          "version": 42
        }
      ]
    }
  ]
}
```

## Regeln

- `deliveries` ist von `executions` getrennt. Traefik-Lieferungen erscheinen nie in `executions` (Spec FR-009, FR-012).
- Reihenfolge der Änderungen unverändert (älteste zuerst, das Frontend dreht sie um).
- Eine Zeile je (Änderung, Traefik-Aktion), nur wenn ein Ereignis des Providers die Änderung nennt. Ohne Ereignis gibt es keinen Eintrag (Spec FR-007).
- `404` für unbekannte oder fremde Geräte wie bisher.
- Bei Ereignissen vor Einführung von `absorbedCausationIds` gibt es nie `kind = "combined"`.
