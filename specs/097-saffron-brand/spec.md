# Feature Specification: Saffron brand

**Feature Branch**: `feat/305-saffron-brand` · **Issue**: #305 · **Status**: Implemented (2.62.0)

## User Scenarios & Testing

### User Story 1 — One mark everywhere (P1)
The owner chose a new logo: a white line robot with two chat bubbles on a saffron rounded tile. The panel (header,
sign-in, install hint, favicon, home-screen icons), the consent pages, the install progress page, the website and the
link-preview card show it.

**Acceptance**: 1. The panel header and favicon show the small mark; sign-in shows the full mark. 2. Adding the panel
to a phone's home screen gives the saffron icon (iOS and Android, maskable inside the safe circle). 3. The website's
marks are byte-identical to the panel's.

### User Story 2 — Colours match the mark (P1)
The accent colour of the panel, consent pages, install page, website, README badges, doc buttons and diagrams is the
mark's saffron instead of lime, in light and dark mode.

**Acceptance**: 1. Text and icons on saffron use the dark on-accent ink and meet 4.5:1 / 3:1 (`check:responsive`).
2. Warnings are amber and "ok" is green, so neither reads as the accent.

### Edge Cases
- Tiny sizes (16–40 px): the detailed mark is illegible, so a simplified small mark (robot head) is used.
- iOS shows transparent corners as black: the apple-touch icon is a full square.

## Requirements
- **FR-001**: One master mark (`logo.svg`) and one small mark (`logo-small.svg`); every icon is rendered from the
  master by a script (`npm run brand:icons`), never by hand.
- **FR-002**: The website holds identical copies; CI fails when they differ.
- **FR-003**: The link-preview card is drawn by `npm run site:shots` from the mark and the phone overview (under 150 KB).
- **FR-004**: Colour tokens change in one place per surface (panel, consent pages, website, install page); no inline lime left.
- **FR-005**: No WhatsApp/Telegram look-alike (no green or blue speech bubble tile, no handset, no plane).

## Success Criteria
- **SC-001**: `check:responsive` passes at 375 / 393 / 1440 px, light and dark, contrast included.
- **SC-002**: The panel's first screen does not grow (the mark is a cached file, not code).
