# ArtifactTuner — XDF Map Editor

View and edit ECU maps in your browser from a TunerPro **XDF** definition and a **BIN** read. One HTML page: no install, and your files never leave your computer (the page only loads its fonts from Google Fonts).

## What it does

- Opens TunerPro XDF files: tables (maps and curves) and constants; 8/16/32-bit, signed/unsigned, little/big-endian, 32-bit float, strides, base offset; axes from data, labels or index. Unsupported items (linked axes, multi-variable equations, flags) are listed in a load report and skipped. Items whose equation cannot be inverted are read-only; items that point past the end of the BIN are disabled.
- Shows each map as a heat-coloured grid with its axes, plus a rotatable 3D surface (maps) or a line graph (curves). Physical or raw values.
- Edits: set, ± step, × %, interpolate (rows, columns, corners), smooth, revert, copy/paste with Excel or Numbers (a comma decimal such as 1,5 or 0,125 is accepted; a value like 1,500 is refused as ambiguous — type 1.5 or 1500), undo/redo. In the grid, − steps the selection down; type negative values in the Value box.
- Compares against the loaded file or another BIN of the same size: changed cells and axis values are outlined, each category shows how many tables differ, each differing table is marked Δ with what changed (cells and/or axes), and the list shows only differing tables until you untick "Differences only". An A / B / Δ switch shows your map (A, editable), the compare file's map (B) or the difference A − B per cell in blue (A lower) and red (A higher); the graph follows the switch. Bytes that differ outside every table of the XDF are listed at the top (address and A → B bytes), so a change the XDF does not describe is never hidden; an area one file has blank (all 0xFF) while the other has data, as in a calibration-only file, is named there and not counted.
- Saves the edited BIN. In claude.ai the download is a .zip with the BIN and changes.txt; locally the BIN is saved directly and the Change log button saves changes.txt.

## Checksums

Checksum correction is per ECU, through plugins in `src/checksums/`.

- **Siemens EMS2000** (Mini): the calibration CRC is recomputed on save when your edits touch it. Boot and program CRCs are only checked, never changed. If you edit bytes inside a boot or program checksum range, the file is saved with `_CHECKSUM-NOT-FIXED` in its name. An EMS2000 file whose calibration CRC does not match when it is loaded is treated as unrecognised.
- If an edit changes a checksum's own header (its ranges or seed), the file is saved with `_CHECKSUM-NOT-FIXED`; if the header no longer fits the file, nothing is saved.
- **Any other ECU**: the file is saved unchanged apart from your edits, named `_CHECKSUM-NOT-FIXED`. Correct the checksum in WinOLS or your flashing tool before flashing.

Every save is checked again before it is offered: if the corrected checksum does not verify, or any byte other than your edits and the checksum changed, nothing is saved.

## Use it

- **In claude.ai**: open the published Artifact. Saving gives you a `.zip` with the `.bin` and `changes.txt` (the Artifact sandbox does not allow saving `.bin` files directly). Unzip it and flash the .bin, never the .zip.
- **Locally**: `npm run build`, then open `dist/xdf-editor-local.html` in Safari or Chrome. Saving gives you the `.bin` directly.

Drop the XDF and the BIN anywhere on the page, or use Open XDF / Open BIN.

## Develop

Building needs Node 22+. The tests also need Python 3 and `unzip`. No npm dependencies.

```bash
npm test          # node --test
npm run build     # writes dist/
```

The tests run against private ECU files that are not in this repository. They are looked up in the folder above the repository, or in the folder named by `ARTIFACT_TUNER_DATA`. Never commit BIN or XDF files or data decoded from them.

Design and implementation notes: `docs/`.

## Disclaimer

Writing a modified calibration to an engine ECU can damage the engine. Verify every change with logging before you rely on it.
