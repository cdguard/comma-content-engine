# Content Engine

Osobný obsahový kokpit ako PWA — zachytenie nápadov, fronta draftov a archív. Beží čisto v prehliadači (bez servera, bez kreditov, bez CDN závislostí), dáta zostávajú v zariadení (localStorage + IndexedDB).

Nasadené na GitHub Pages: https://cdguard.github.io/comma-content-engine/

## Čo aplikácia vie

- **Zachytenie** — textové poznámky aj hlasové nahrávky (MediaRecorder → IndexedDB).
- **Fronta draftov** — karty s názvom, kanálom (Web / Bluesky / Reddit-človek) a farebným stavom: Surovina → Draft → Na korektúru → Schválené → Publikované.
- **Načítanie draftov z repozitára** — tlačidlo „Obnoviť drafty“ stiahne `drafts.json` z tohto repa a zlúči nové drafty do fronty. Lokálne stavy (schválené, publikované, upravené) sa neprepíšu.
- **Archív** — publikované kúsky s dátumom, možnosť zobraziť a skopírovať text.
- **Export/Import** — celý stav (vrátane zvukových nahrávok) ako jeden JSON na prenos medzi telefónom a notebookom.
- **Ako to funguje** — v záložke Dáta je vysvetlený celý manuálny tok (surovina → agent → drafty → schválenie).

## Inštalácia na Android

1. V Chrome (alebo Vivaldi) otvor https://cdguard.github.io/comma-content-engine/
2. V menu (⋮) zvoľ **Pridať na domovskú obrazovku** / **Inštalovať aplikáciu**.
3. Potvrď — appka sa spustí na celú obrazovku s vlastnou ikonou.

Na desktope (Chrome/Edge/Vivaldi) sa tlačidlo „Inštalovať“ objaví v adresnom riadku.

## Export dát

Záložka **Dáta** → **Exportovať všetko (JSON)** (alebo **Kopírovať JSON**). Súbor potom importuj na druhom zariadení cez **Importovať zo súboru JSON**.

## Drafty z repozitára (drafts.json)

Agent pripravuje drafty a ukladá ich do tohto repa ako `drafts.json`. Je to pole objektov:

```json
[
  {
    "id": "d-ukazka-1",
    "title": "Názov draftu",
    "channel": "web",
    "body": "Text draftu…",
    "status": "review",
    "createdAt": "2026-10-28T00:00:00.000Z",
    "updatedAt": "2026-10-28T00:00:00.000Z"
  }
]
```

- `id` — stabilný identifikátor (rovnaký id = rovnaký draft, lokálna verzia má prednosť).
- `channel` — `web` | `bluesky` | `reddit`.
- `status` — `raw` | `draft` | `review` | `approved` | `published`.
- `body` — text draftu (v appke sa zobrazí ako text).

V appke stlač **Drafty → Obnoviť drafty**. Ak `drafts.json` neexistuje alebo je neplatný, appka beží ďalej bez chyby. Ukážkové drafty majú v názve „(ukážka)“.

## Dôležité

- Dáta sú len lokálne — odinštalovaním alebo zmazaním dát prehliadača o ne prídeš, preto rob pravidelné exporty.
- **Aplikácia negeneruje text modelom.** Drafty sa vkladajú ručne alebo ich pripraví agent mimo aplikácie.

## Súbory

- `index.html`, `styles.css`, `app.js` — aplikácia (bez frameworku, bez build kroku).
- `manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png` — PWA manifest a ikony.
- `drafts.json` — drafty pripravené agentom, ktoré appka načítava.
- `sw.js` — service worker (cache-first pre shell).
