# Sonance 3.12

Install **one** package: `Sonance3.wgt` (square icon) or `Sonance3-Oblong.wgt` (wide home-row tile). Settings → About reads **V3.12**.

3.12 is the community release: it brings in three pull requests. Thank you to **David BELEY** ([@dbeley](https://github.com/dbeley)), whose [#2](https://github.com/MrSimmo/sonance3/pull/2) first built the playback, sorting, Home and artist features below and whose [#1](https://github.com/MrSimmo/sonance3/pull/1) adds a NixOS dev shell, and to **Anupam Mediratta** ([@anupamme](https://github.com/anupamme)) for [#5](https://github.com/MrSimmo/sonance3/pull/5). #2 was written before 3.9, so its features were rebuilt on 3.11's code; every commit that carries one credits David as co-author.

## New

- **Opus playback** — Opus files stream through your server as MP3 (320 kbit/s), so the TV can play them; seeking reloads the stream from the new position, and the next track still lines up gaplessly (dbeley)
- **Albums: Random** — a new sort on the Albums header shows a random selection of up to 500 albums; choose Random again for a new one (dbeley)
- **Artists sort** — the Artists tab gets a header with a Sort button: Name, Most albums or Random (dbeley)
- **Albums per Home row** — Settings → Appearance: Standard (6), 9 or 12 albums in every album row on Home; the default is unchanged (dbeley)
- **Popular songs** — an artist's page lists their ten most popular songs when your server knows them (Navidrome with Last.fm); OK plays from there, hold OK for options (dbeley)

## Improved

- **A track that will not play says why** — its name, and whether the format is not supported or it could not be loaded, instead of a silent skip (dbeley)

## Fixed

- Moving back up an artist page no longer leaves the first album cut off at the top (larger interface sizes)
- Opening a similar artist from an artist page now shows that artist's albums, biography and similar artists (they could be drawn on the page being left), and a slow answer for a page you have left no longer fills the next one (dbeley)

## For developers

- `shell.nix` for NixOS (`nix-shell`), and `build.sh` now starts with `#!/usr/bin/env bash` (dbeley, #1)
- The test helpers check the screenshot data they decode (anupamme, #5)
- The test server can stand in for a transcoding server (MP3, no byte ranges), and the suite covers every change above
