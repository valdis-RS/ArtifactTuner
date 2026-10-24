# XDF map editor — design

Date: 2026-10-24
First target: Mini EMS2000 (EMS2K 111441901203EHC3), `Mini/EMS2K_111441901203EHC3.xdf` +
`Mini/TB62572_EMS2K_111441901203EHC3_fullread_EKII.bin` (512 KB, ST10/C167).
Second XDF exercised by tests: `BMW_Siemens_MSV70_9PPL921S_128K.xdf` + `S7581295.bin` (128 KB, PowerPC).

## 1. Goal and scope

A browser-based map viewer and editor driven by a TunerPro XDF and an ECU BIN — a macOS-friendly
replacement for the TunerPro/WinOLS map-editing workflow. Delivered as one self-contained HTML file,
published as a claude.ai Artifact and also usable as a local file opened from Finder.

In scope:

- General XDF engine: tables (maps and curves) and constants; 8/16/32-bit, signed/unsigned,
  LSB/MSB-first, 32-bit float, strides, base offset; axes from embedded data, labels or index.
- Viewing: category tree, search, heatmap grid, physical/raw toggle, 3D surface for maps,
  2D graph for curves.
- Editing: set, ± step, × %, interpolate, smooth, revert, copy/paste TSV, undo/redo.
- Compare: changed-cell highlighting against the original BIN or a separately loaded compare BIN;
  "modified only" filter.
- Checksums: per-ECU plugin. EMS2K plugin corrects the calibration CRC only. Unknown ECUs save
  with an explicit "checksum not fixed" marking.
- Save: Artifact → `.zip` (the `downloads` capability does not allow `.bin`); local file → `.bin`.

Out of scope (v1): editing axis values (axes are read-only — EMS2K axes live in shared pools and
one edit would silently move many maps), XDF authoring, hex view, linked axes (`embedinfo` type
2/3), multi-variable MATH, `XDFFLAG` bit items, checksum plugins other than EMS2K, autosave,
multi-file sessions.

Scope line carried over from earlier EMS2K work: the tool edits calibration only and must never
correct boot/program-area checksums. The EKII plain read is the test target for saved output.

## 2. XDF and BIN facts this design relies on

Measured on the two XDFs (2026-10-24):

| | EMS2K | MSV70 |
|---|---|---|
| `XDFTABLE` / `XDFCONSTANT` | 466 / 105 | 2183 / 6086 |
| element sizes | 8, 16 | 8, 16, 32 |
| `mmedtypeflags` | `0x02` everywhere | `0x01` on 1185, absent elsewhere |
| axis kinds | `embedinfo type="1"`, `LABEL` | `embedinfo type="1"`, `LABEL` |
| equations | all linear (`X*0.75-48`, `(X-128)*0.375`, `X*32`, …) | all linear (`0.750000 * X+ -48.000000`, …) |
| non-`X` VARs, linked axes, `XDFFLAG` | none | none |
| `BASEOFFSET` | 0 | 0 |

- **Byte order comes from `mmedtypeflags` only.** Absent flags = 0 = MSB-first unsigned. The
  header `DEFAULTS lsbfirst="1"` is an authoring default and is ignored for decoding. Verified:
  MSV70 `id_maf_n_min_fcut_fast` x-axis at 0xA92 reads `1200, 2400, 3600, 4800` big-endian and
  garbage little-endian.
- Flag bits: `0x01` signed, `0x02` LSB-first, `0x10000` IEEE float (32-bit). `0x04` is treated as
  column-major; neither test XDF uses it, so this mapping is unverified. Any other set bit marks
  the item unsupported.
- `CATEGORYMEM category="N"` is 1-based: N refers to `CATEGORY index="N-1"` (EMS2K: ignition
  curve has `category="1"` → index 0x0 "Ignition").
- Table shape: z `mmedrowcount` × `mmedcolcount` (default 1); x `indexcount` = columns,
  y `indexcount` = rows. A curve is 1 row.
- Strides: `mmedminorstridebits` = distance between consecutive elements in a row,
  `mmedmajorstridebits` = distance between rows; 0 means packed. Unverified (both XDFs use 0).
- File offset = `mmedaddress + offset` (`subtract="0"`) or `mmedaddress − offset`
  (`subtract="1"`). Unverified for non-zero.
- EMS2K checksums (from `Mini/mapswitch/checksum.py`, already validated): three CRC-16/ARC sums
  (reflected, poly 0xA001, 256-word table at file 0x11232), seeds and ranges read from the image:
  - boot: stored 0x3ED4, seed word 0x3FE6, range from far pointers 0x3ED8/0x3EDC
  - prog: stored 0x10010, seed at far ptr 0x10B9C, `w(0x10012)` ranges from 0x10014 (8 bytes each)
  - cal: stored 0x77FE0, seed at far ptr 0x10BBC, `b(0x77FE2)` ranges from 0x77FE4 (8 bytes each)
  - Far pointer = offset word, segment word; addresses ≥ 0x80000 map to file − 0x80000.
    Range ends are inclusive.
  - Known state: EKII all three match; EKIInonews prog CRC mismatches (stored 5233, computed 0263);
    `EKII_mapswitch.bin` is an unfixed build.

## 3. Architecture

Git repository `ArtifactTuner` (github.com/valdis-RS/ArtifactTuner, **public**), checked out at
`MSV70/ArtifactTuner/`. The ECU files stay outside it in `MSV70/`; no BIN, XDF or data decoded
from them is ever committed. Paths below are relative to the repository root:

| File | Responsibility |
|---|---|
| `src/xml.js` | Minimal XML parser → `{tag, attrs, children, text}`. Handles comments, self-closing tags, the five named entities and numeric entities (`&#013;`). Reports line/column on error. No `DOMParser`, so Node tests run the same code. |
| `src/xdf.js` | XML tree → model `{title, baseOffset, categories[], items[], report}`. Item: `{uid, kind: 'table'|'constant', title, desc, categoryIds[], z: Elem, x: Axis, y: Axis, readOnly, reason}`. `Elem`: `{addr, bits, signed, lsbFirst, float, colMajor, rows, cols, majorStride, minorStride, math, units, decimals}`. `Axis`: `{kind: 'embedded', elem, count} | {kind: 'labels', labels[]} | {kind: 'index', count}`. Unsupported items are kept in `report.skipped` with a reason. |
| `src/codec.js` | `cellOffset(elem, r, c)`, `readRaw(img, elem, r, c)`, `writeRaw(img, elem, r, c, raw)`, `rawRange(elem)`. Pure functions on `Uint8Array`. |
| `src/math.js` | Recursive-descent parser for `+ − * / ^ ( )`, unary minus, numbers, `X` → `f(x)`. `inverse(f, rawRange)`: sample to detect linearity (exact `x = (y − b) / a`); otherwise bisection if monotonic over the raw range; otherwise `null` (item read-only). `toRaw(y)` rounds to the nearest integer raw (floats stay float) and clamps to `rawRange`, returning `{raw, clamped}`. |
| `src/image.js` | `original` (immutable copy), `working`, `reference` (= original unless a compare BIN is loaded; size must match). Edits are applied as action groups of byte patches `{off, before, after}` → undo/redo stacks; `editedOffsets()` and `isItemModified(item)` derive from working vs original; compare highlighting uses working vs reference. |
| `src/checksums/index.js` | Plugin registry; `pick(originalImg)` returns the first plugin whose `detect` passes, else `null` (unknown ECU) with each plugin's rejection reason. |
| `src/checksums/ems2k.js` | Port of `checksum.py`: `detect(img)`, `verify(img) → {boot, prog, cal: {calc, stored, ok}}`, `fix(img, editedOffsets) → {img, fixed[], notFixed[]}`. |
| `src/zip.js` | Store-only (method 0) zip writer with CRC-32; `zip([{name, bytes}]) → Uint8Array`. |
| `src/save.js` | Builds the output: runs the plugin, the post-fix self-check (section 4), the filename, `changes.txt`; then `downloads.save` (Artifact) or a Blob link download (local). |
| `src/ui/*.js` | `app.js` (state, wiring, drag-drop, keyboard), `sidebar.js`, `grid.js`, `toolbar.js`, `surface3d.js`, `graph2d.js`, `status.js`. |
| `src/style.css` | Light/dark tokens, layout. |
| `build.js` | Inlines CSS and JS (fixed order) into `dist/xdf-editor.html`. |
| `tests/*.test.js` | `node --test`. |

Data flow: XDF text → `xdf.parse` → model. BIN bytes → `image`. Selecting an item → codec + math
decode every cell and axis → grid and graph render. An edit → `math.toRaw` per cell → one patch
group on `working` → re-render and update sidebar markers. Save → `checksums` → self-check →
zip/bin → download.

A test hook `window.xdfedit = {load(xdfText, binBytes, binName), loadCompare(bytes)}` is exposed;
it is the same code path as the file pickers.

## 4. Checksums and saving

Plugin choice runs on the **original** BIN. EMS2K `detect` requires all of:

1. image length is 0x80000;
2. the 256 words at 0x11232 equal a freshly generated CRC-16/ARC (0xA001 reflected) table;
3. every cal range lies inside 0x70000–0x7FFFF and the stored cal CRC (0x77FE0–0x77FE1) is
   outside all cal ranges;
4. the stored cal CRC verifies on the original.

Failure → unknown ECU; the status shows which check failed.

Status pill (always visible once a BIN is loaded): boot / prog / cal, each `calc` vs `stored`,
green or red. For EMS2K, boot and prog are verify-only.

On save:

- If no edited offset lies inside a cal range, the cal CRC is left as is.
- If any edited offset lies inside a cal range, recompute the cal CRC over the working image and
  write it to 0x77FE0.
- If any edited offset lies inside a boot or prog range, nothing is corrected for that region;
  the output is marked **not fixed**.
- Edited calibration bytes outside every CRC range need no action.

Self-check after fixing, before anything is offered for download:

- re-verify cal on the output image;
- diff output vs original: every changed byte must be an edited offset or one of the 2 cal CRC
  bytes.

If either check fails, the save is aborted with an error and nothing is downloaded.

Unknown ECU or a not-fixed region: save still works; the filename gets `_CHECKSUM-NOT-FIXED`
and a red banner tells the user to correct the checksum in WinOLS or their flasher before
flashing.

Output names (`<base>` = loaded BIN name without extension):

- Artifact (`claude.use("downloads")` resolves): `<base>_edit[_CHECKSUM-NOT-FIXED].zip` containing
  `<base>_edit[…].bin` and `changes.txt`. `changes.txt` lists each changed item (title, address,
  cells changed, min/max Δ in physical units) and the checksum report before/after.
- Local file (no `window.claude`, or `use` resolves `null`): `<base>_edit[…].bin` via a Blob link;
  an "Export change log" button saves `changes.txt`.
- `downloads.save` errors: `declined` → status note; `rate_limited` → status note, user can click
  again; `unavailable`/`not_granted`/other → status note. Never auto-retry. Edits are kept.
- `beforeunload` warns while there are unsaved edits.

## 5. UI

Top bar: Open XDF · Open BIN · Compare BIN · checksum pill · Undo · Redo · Save. Both files can
also be dropped anywhere; XML vs binary is detected from content (first non-space char `<`).

Load report (dismissable panel): counts of tables/constants loaded, skipped items with reasons,
BIN size vs XDF `REGION` size mismatch, items disabled because their bytes run past the BIN end.

Sidebar: search over title, description and hex address; "modified only" toggle; XDF categories
collapsible with counts (items in several categories appear in each); ● = modified vs reference,
⚠ = read-only/disabled (reason on hover). Category contents render on expand only.

Main panel:

- Header: title, address, shape, element type, units, description; physical/raw toggle.
- Grid: x-axis header row, y-axis header column (axis values decoded with their own math),
  per-table heatmap colouring (table's own min..max), edited-vs-reference cells outlined,
  hover tooltip `ref <a> → <b> (Δ <d>)`.
- Selection: click, drag, shift-click, arrow keys (shift extends), click a row/column header to
  select it, Cmd+A selects the table.
- Edit operations (each is one undo step):
  - type a number + Enter → set selection;
  - `+` / `−` → step selection by the step value (default = one raw LSB in physical units,
    editable in the toolbar);
  - `×%` → multiply by (1 + p/100);
  - Interpolate → horizontal (each row between its first and last selected cell), vertical, or
    bilinear from the selection's four corners;
  - Smooth → each selected cell becomes the mean of its 3×3 neighbourhood, neighbours limited to
    the selection;
  - Revert → selection back to reference values;
  - Cmd+C / Cmd+V → TSV via the native `copy`/`paste` events (Excel/Numbers compatible); paste
    starts at the selection's top-left and is clipped to the table.
- Values are computed in physical units, converted with `toRaw`, and the cell shows the value
  decoded back from the stored raw. Any clamp shows a status line (`clamped to 95.6`).
- Graph pane: maps → canvas 3D surface (shaded quads, painter's order, drag to rotate, wheel to
  zoom, selected cells highlighted, reference drawn as a wireframe when it differs); curves → 2D
  line graph with the reference dashed; constants → a single value field with the same edit rules.

Theming and size: colours as `:root` tokens with a dark set; under 760 px wide the sidebar
becomes a drawer and the grid scrolls inside its own panel. Browser storage only for UI
conveniences (last physical/raw choice, panel sizes), wrapped in try/catch.

Artifact: title "XDF Map Editor", `capabilities: {downloads: true}`, nothing else declared.

## 6. Error handling

- XDF parse error → message with line/column; nothing replaced.
- BIN without XDF (or vice versa) → prompt for the other file.
- Non-invertible math, unsupported flags, out-of-bounds addresses → item read-only or disabled
  with a reason (sidebar ⚠ and load report).
- Compare BIN of a different size → refused with a message.
- Save failures → section 4.

## 7. Testing

Automated (`node --test`, against the real files in `MSV70/`, the folder above the repository;
`ARTIFACT_TUNER_DATA` overrides it):

1. XML/XDF: EMS2K → 466 tables / 105 constants; MSV70 → 2183 / 6086; MSV70 parses in under 3 s.
2. Decode: EMS2K base ignition 0x75EF2 (16 × 12, 8-bit) and VE 0x7C69A (20 × 12, 16-bit) cell
   values and axes equal an independent Python read of the same bytes (`tests/fixtures/make_fixtures.py`,
   run by the test into a temp folder, so no decoded data is committed).
   MSV70 `id_maf_n_min_fcut_fast` x-axis = 1200, 2400, 3600, 4800.
3. Math: for every distinct equation in both XDFs and every raw value in its element's range
   (16-bit: full range; 32-bit: 10 000 samples incl. ends), `toRaw(f(raw)).raw === raw`. A
   non-linear monotonic equation exercises the bisection path; a non-monotonic one returns `null`.
4. Checksums: JS `verify` equals `python3 Mini/mapswitch/checksum.py verify` for EKII, EKIInonews
   and EKII_mapswitch (EKIInonews prog mismatch reproduced exactly). `detect` passes on EKII,
   fails on a 128 KB MSV70 BIN.
5. Save end-to-end: edit ignition cells on EKII → save bytes → `checksum.py verify` reports cal OK;
   diff vs original = edited offsets + 0x77FE0/0x77FE1 only.
6. Guard: edit a byte inside a prog range → output marked not fixed; prog CRC bytes unchanged.
   EKIInonews with a cal edit → cal fixed, prog mismatch left exactly as loaded.
7. Zip: Python `zipfile` opens the output, `testzip()` passes, and the inner `.bin` is
   byte-identical to the image.

UI verification: serve `MSV70/` with a local static server, open `ArtifactTuner/dist/` in the browser pane, load EKII +
EMS2K XDF through `window.xdfedit.load`, and exercise selection, each edit operation, undo/redo,
paste, compare BIN, 3D and 2D graphs, theme switch, phone width and save (local path). Then publish
the Artifact and check load, edit and the zip save prompt there.

## 8. Risks

- `<input type=file>` and drag-drop inside the Artifact sandbox are assumed to work; checked at the
  first publish. If blocked, the Artifact is documented as view-of-local-file only and the local
  HTML is the primary path.
- Flag `0x04`, non-zero strides and non-zero `BASEOFFSET` are implemented from the XDF format
  description but untested on real files.
- Native `copy`/`paste` events inside the sandbox are assumed to work; checked at the first publish.
