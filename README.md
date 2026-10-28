# Content Engine

Osobný obsahový kokpit ako PWA — zachytenie nápadov, fronta draftov a archív. Beží čisto v prehliadači (bez servera, bez kreditov, bez CDN závislostí), dáta zostávajú v zariadení (localStorage + IndexedDB).

Nasadené na GitHub Pages: https://cdguard.github.io/comma-content-engine/

## Čo aplikácia vie

- **Zachytenie** — textové poznámky aj hlasové nahrávky (MediaRecorder → IndexedDB).
- **Fronta draftov** — karty s názvom, kanálom (Web / Bluesky / Reddit-človek) a stavom: Surovina → Draft → Na korektúru → Schválené → Publikované.
- **Archív** — publikované kúsky s dátumom, možnosť zobraziť a skopírovať text.
- **Export/Import** — celý stav (vrátane zvukových nahrávok) ako jeden JSON na prenos medzi telefónom a notebookom.

## Inštalácia na Android

1. V Chrome (alebo Vivaldi) otvor https://cdguard.github.io/comma-content-engine/
2. V menu (⋮) zvoľ **Pridať na domovskú obrazovku** / **Inštalovať aplikáciu**.
3. Potvrď — appka sa spustí na celú obrazovku s vlastnou ikonou.

Na desktope (Chrome/Edge/Vivaldi) sa tlačidlo „Inštalovať“ objaví v adresnom riadku.

## Export dát

Záložka **Dáta** → **Exportovať všetko (JSON)** (alebo **Kopírovať JSON**). Súbor potom importuj na druhom zariadení cez **Importovať zo súboru JSON**.

## Dôležité

- Dáta sú len lokálne — odinštalovaním alebo zmazaním dát prehliadača o ne prídeš, preto rob pravidelné exporty.
- **Aplikácia negeneruje text modelom.** Drafty sa vkladajú ručne alebo ich pripraví agent mimo aplikácie.

## Súbory

- `index.html`, `styles.css`, `app.js` — aplikácia (bez frameworku, bez build kroku).
- `manifest.webmanifest` + `icon.svg` — PWA manifest a ikona.
- `sw.js` — service worker (cache-first pre shell).
