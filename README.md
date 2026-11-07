# DVD Art

A React SPA that turns an image into visible artwork on the **recording side** of a blank single-layer DVD. The image stays in the browser. Go, compiled to WebAssembly, performs tone processing, dithering, physical spiral mapping, inverse scrambling, and ISO9660 generation.

Production: https://dvd-art.emfsoft.com  
Source: https://github.com/officialdavidtaylor/disk-art

## Run

Requires Go 1.23+ and a Node.js release supported by the pinned Cloudflare CLI (24.22+ in the Node 24 line, or 22.23+ / 26.12+). The application build and encoder were verified with Node 24 and Go 1.27.3.

```sh
npm ci
npm run build:wasm
npm run dev
```

If Go is not on PATH, set `GO_BIN=/absolute/path/to/go`. The build copies `wasm_exec.js` from that exact Go toolchain. Generated WebAssembly and runtime files are ignored in Git.

```sh
npm run build
npm test
npm run preview
```

## Use

1. Import PNG, JPEG, WebP, GIF or BMP (up to 40 MB / 64 megapixels). Animated images are frozen at import. Sources are retained at up to 4096 pixels on their longest side.
2. Drag or use numeric position controls, scale, rotate, and mirror. Adjust contrast, brightness, gamma, threshold, dithering, or inversion.
3. Choose the actual blank media. Generic DVD+R uses 2,295,104 sectors. Measured DVD−R/+R presets and custom radii, channel-bit length, pitch coefficients and starting angle are available.
4. Generate the full ISO, or a 32,768-sector / 67,108,864-byte inner-ring test. **The test covers only a thin inner annulus**, using full-disc geometry; it is not a miniature copy of the entire artwork.
5. In an ordinary burning application choose **burn disc image**, use a blank single-layer DVD with enough capacity, and finalize the disc. Copying the ISO as a regular file does not reproduce the artwork.

Chrome/Edge can stream directly to a selected output file. Other browsers with the necessary Origin Private File System APIs spool to temporary local storage, then expose a download. The spool is cleaned on replacement or normal teardown; after an interrupted tab, the next export in that tab removes its prior spool. Browser storage and a second downloaded copy may require roughly twice the ISO size. Generation is cancellable and runs in a Web Worker with backpressure: one 512 KiB chunk is written before the next is requested. No 4.7 GB array or in-memory Blob is assembled.

The Go binary is about 4.55 MB uncompressed with the verified toolchain. A progress bar reports the actual downloaded bytes; SHA-256 verification detects incomplete or stale downloads. The app uses no remote fonts, image services, telemetry, or backend encoder.

## Calibrate a burner / media combination

Open **Calibrate your discs**. Maxell DVD+R is the default nominal starting point (24–58 mm, 2,295,104 sectors, 133.3 nm channel bits); it is **not a measured Maxell preset**. Confirm the blank's sector capacity in your burning application. Keep the burner, media batch and write speed consistent.

1. Create a **broad rings** burn record, enter the burner and speed, save its JSON, and generate the full 4.70 GB calibration ISO. Burn/finalize a new blank as a disc image. Label the disc with the record ID. A short inner-ring export cannot calibrate the complete recording area.
2. Photograph the recording side straight on, with the entire physical 120 mm rim visible. Import the photo and mark its left, right, top and bottom extremes. The UI checks circularity and centre consistency; it does not correct perspective or lens distortion. Zoom and scroll for accurate points. Alternatively measure radii directly with suitable measuring equipment.
3. Mark the six dark-band edges, inside outward along one radial direction, or enter their radii in millimetres. Fit the recording area, name the profile, then **Save & apply profile**. This is a coarse radius estimate, not a finished spiral calibration.
4. Create a **triangle spokes** record and select the measured profile directly under **Starting geometry**. A successful ring burn by itself does not apply a calibration: measure the six edges and save/apply their fit first. Save the new record and optional target SVG, generate the full ISO, then burn a fresh blank at the same successful write speed (4× is the default).
5. Photograph the recording side straight on and mark the four physical rim extremes. Pick either the clockwise or counterclockwise long edge of **one** triangle and follow it from base toward tip, including every winding. The orange preview edge illustrates the selection. Avoid the short base and the last 0.5 mm near the tip. Add points with less than 60° between neighbours; do not switch spokes. Variable-pitch fitting defaults on for triangles and requires at least 24 points over 85% of the recording width. With it off, use at least 12 points and 65% coverage. Manual radius/angle entry is also available; angles increase clockwise from the right.
6. Fit and inspect the green photo overlay, residuals, angular-drift plot and before/after geometry table. The report shows accumulated drift in degrees and turns, peak-to-peak drift, radius corrections and inferred inner/outer track pitch. Photo rotation and the triangle's known taper are removed from the drift plot. Save/apply the result, then make another triangle or **single line** burn to verify straight edges before returning to photographs. If edges are too tangled to follow, use the coarse angular sweep below before another triangle burn. The single-line pattern remains available: trace its centre with less than a quarter turn between points.

Profiles and up to 40 burn records persist in local browser storage. Export/import JSON for backups or another browser. A burn record freezes its pattern and geometry; switching current profiles never alters an existing record. Measurements are retained, while photos themselves are not persisted. Applying a profile selects it in the artwork disc menu. The applied profile and custom geometry now survive reloads, and the exact active radii are shown beside the artwork export controls. Replacing a photo resets measurements, avoiding accidental mixing of image scales.

The Go encoder renders calibration analytically, without raster resampling or dithering. The bands occupy logical-sector fractions `[.035,.170)`, `[.305,.510)`, `[.705,.955)`, with edges rounded upward to whole sectors. Coarse fitting regresses squared radius against these exact fractions under a constant-pitch approximation and clears prior pitch corrections. The `triangles-v1` pattern contains four Cartesian triangles at 90° intervals, with 8 mm bases and tips pointing outward; the base and tip sit 0.6 mm inside the respective recording boundaries. Its pattern identifier freezes that design for reproducible saved records. The alternative fine pattern is a single 1.2 mm radial line. Triangle fitting analytically includes the chosen sloped edge rather than treating it as a radial line. A bounded damped least-squares fit minimizes the **unwrapped** phase difference between the actual and frozen generation spirals. It fits inner/outer radii, optional cubic pitch, and photo rotation; channel-bit length stays fixed. Reported fine residuals are local perpendicular distances, not absolute physical accuracy. Radius refinement is limited to ±0.3 mm, and individual pitch coefficients to ±0.005.

Skipped complete turns, switching spokes, incorrect centring, photo distortion, and overfitting can still produce misleading fits with small residuals. A constant start-angle correction only rotates artwork; it cannot correct winding into rings or spirals. The fitted rotation absorbs arbitrary photo orientation and chosen spoke, and is not applied as a start-angle correction. This model does not identify mechanical spindle-axis displacement, disc wobble, or channel-bit length independently. The workflow requires physical verification on a fresh blank. Triangle fitting has been tested with synthetic geometry and browser exports; it has not yet been validated by a physical triangle burn.

### Coarse angular sweep for indiscernible artwork

Open https://dvd-art.emfsoft.com/?calibration=sweep and select **Prepare Maxell sweep**. This creates a fresh `sweep-v1` record from the bundled `e3ff7e7e` broad-ring fit: inner radius **24.01779148781394 mm**, outer radius **57.82313919831214 mm**, 2,295,104 sectors, 133.3 nm channel bits, zero pitch corrections. The original six measurements and derived profile are preserved in `src/baselines/maxell-e3ff7e7e.json`. This is a coarse measurement for the user's Lenovo GP60NB50 / Maxell DVD+R / 4× combination, not a general Maxell preset or a completed angular calibration. The shortcut freezes that baseline regardless of the current artwork selection.

1. Save the JSON record and numbered SVG strip map. Generate the full **4,700,372,992-byte** sweep ISO; no short-export option is used. Burn it as a disc image on a fresh Maxell DVD+R at **4×**, finalize it, and label it with the record ID.
2. Look for **three groups of 21 strips**, counted from the hub outward. Each strip changes angular rate from −1.0% to +1.0% in 0.1% steps. Strip 11 leaves the baseline rate unchanged. Larger gaps follow strips 5, 10, 15 and 20. Each patch contains broad light/dark regions, not a recognizable picture; the on-screen annuli are a locator, not an appearance prediction.
3. Select the least-winding strip in each group. Follow one continuous light/dark edge across that strip, from its inner boundary to its outer boundary. It must make no complete turn and move less than 120°. Either of the two opposite edges works; do not switch between them. A straight-on photo showing the full 120 mm rim can supply the angles through the photo tool, or enter them manually. Angles increase clockwise from the right. Export HEIC photos as JPEG first. If no edge can be followed, leave the group unselected and retain the photo and record for diagnosis.
4. Confirm continuous traces, then **Fit sweep radii**. The fit uses the three signed endpoint differences to refine both radii while holding pitch shape, channel-bit length and start angle fixed. The residual is in **degrees**, not millimetres. Save/apply the profile and verify it with a fresh triangle or line burn before attempting artwork again.

The pattern uses whole-sector gates so candidate strips cannot overlap, even when geometry is wrong. There are 1 mm margins and inter-group gaps; each group has four extra 0.1 mm counting gaps. Within a group, equal-width strips have 0.1 mm normal separation (about 0.354 mm of active width on the bundled baseline). The phase is `theta + (rate − 1) * (theta − midpointTheta)`, anchored at each strip's midpoint sector. The fitter compares actual phase advance with the frozen baseline advance multiplied by the candidate rate. Endpoint differences cancel photo rotation and edge choice within each strip. Fitting searches ±0.5 mm around each baseline radius without wrapping residuals; it rejects RMS disagreement over 5° or a maximum over 8°. Low residuals cannot detect skipped turns or mistaken strip numbers. The next physical burn must establish whether the strips have enough optical contrast to measure.

## What the disc contains

The first 32 sectors (64 KiB, two complete DVD ECC blocks) contain a minimal ISO9660 filesystem:

- `README.TXT`: explains that this is a visual artwork with no playable media.
- `WEBSITE.URL`: links to https://dvd-art.emfsoft.com.

Artwork occupies unallocated sectors in the same volume, with no directory entries pointing to it. No autorun, executable, audio, VIDEO_TS or fabricated DVD-Video structure is included. Computer readers can recognize a normal data volume. A standalone player may show “no playable content” or reject the disc; there is no universal player-compatible “noop.”

## Encoding and fidelity

Starting research: [shared conversation](https://chatgpt.com/share/6aee484e-55a8-83e8-9fce-6329f1f98b47).

The implementation follows [DiscImageStudio](https://github.com/JiaFeiMiao-K-Cat/DiscImageStudio) at commit `c720fd45b76dc4d9257316474dd646a91589ffdb`. See [NOTICE](NOTICE) for reference files and attribution.

For each controllable payload byte, we find the center of its 16 channel bits in the physical spiral. The mapping includes 12-byte sector headers, PI columns, interleaved PO rows, and sync framing: 38,688 channel bits per 2,048-byte logical sector. The main-data scrambler is the ECMA-267 15-stage register, using the physical-sector seed at PSN = LBA + 0x30000. Desired scrambled bytes are 0xA5 (dark texture) or 0x92 (light texture); the ISO stores `payload = texture XOR scramblerMask`.

The drive performs EDC, ECC, EFMPlus modulation and actual recording. Those fields are **not** written into the 2048-byte ISO sectors by this app. About 15% of physical channel positions are outside the artwork payload's direct control. This is the reference project's fast texture approach, not a full EFMPlus optimizer or optical reflectance simulator.

Go uses serpentine Floyd–Steinberg error diffusion at 4096 × 4096 by default. A 2048 mode reduces memory. The editor uses a 768-pixel layout preview, so its dot structure is not pixel-identical to the export. Browser Canvas decodes and positions the source; the signal processing runs in Go.

Geometry supports the upstream cubic radial pitch model, integrated by Simpson quadrature on 8192 radial segments, then inverted using cubic Hermite interpolation. Inside each sync span, a complex rotation plus radial drift advances sampling efficiently. Tests compare the optimized path to direct channel-center sampling and compare constant-pitch geometry with an independent analytic Archimedean model.

**Photographic artwork fidelity remains unverified.** A user-reported Maxell DVD+R calibration burn succeeded after a conventional control ISO burned and verified at 4×, but photographic artwork appeared as rings or spirals. The coarse angular sweep is the next geometry experiment after an indiscernible triangle/artwork burn. Measured presets are useful starting points, not a guarantee across recorders and media lots. Small geometric errors can bend the image. Reflectance, lighting, write strategy, ECC and repetitive-pattern readback issues affect the result. This art-first MVP does not insert the upstream experimental read-compatibility bridge bytes, because they alter the selected texture. Do a test burn and inspect both appearance and readability before relying on the result.

## Verification

`npm test` runs Go tests for scrambling, physical offsets, geometry, chunk determinism, tone coverage, filesystem extents and invalid input, followed by calibration fitting/encoding tests, browser-state schema and photo-scale tests, and a real WebAssembly export of a 67 MB test image. Synthetic fine fits recover radii and cubic pitch and are checked at held-out radii. Triangle tests use independently constructed Cartesian edge points, both edge directions, multiple complete turns, and independent payload membership checks. Sweep tests use an independent analytic Archimedean model over a 25-case ±0.2 mm radius grid, noisy endpoints, malformed observations, and direct payload membership at every strip boundary. Browser QA covers synthetic sweep fitting, record/map downloads, and applied-profile persistence after reload.

```sh
# Stream all 4,700,372,992 bytes through the WASM encoder into a hash;
# does not save a multi-gigabyte file.
node scripts/wasm-smoke.mjs --full

# Exercise the full triangle pattern without saving a large file.
node scripts/wasm-smoke.mjs --full --pattern=triangles-v1

# Exercise the full sweep around the bundled measured baseline.
node scripts/wasm-smoke.mjs --full --pattern=sweep-v1 --baseline=maxell-e3ff7e7e

# Save a test ISO for an independent reader.
TEST_ISO=/tmp/dvd-art-test.iso node scripts/wasm-smoke.mjs
python3 scripts/verify-iso.py /tmp/dvd-art-test.iso  # needs pycdlib
```

Initial verification included a full-capacity WASM stream (47 seconds on the development machine, not a browser performance guarantee), independent pycdlib parsing/extraction, browser import/placement and test-ISO generation. The full measured-baseline sweep also streamed successfully through WASM (4,700,372,992 bytes; SHA-256 `4626fd9ad4c3b8a097f3fefc6104c30d853f9d2b3665052d04cef7dea673e5f8`). Sweep calibration and photographic fidelity still need fresh physical burns with measured geometry.

## Deploy to Cloudflare

The site is static; Go runs on the visitor's machine, not in a Cloudflare Worker. `cloudflare.config.ts` configures Workers Static Assets and the custom domain.

```sh
npx cf auth login
npm run deploy
```

Alternatively use a scoped `CLOUDFLARE_API_TOKEN` in CI. `npm run build:cloudflare` prepares the Cloudflare Build Output Specification from `dist/`; `cf deploy --prebuilt` uploads that output. The initial release used the connected Cloudflare API with a short-lived asset-upload session. No credentials are stored in this repository.

Deploy the whole `dist/` together. `encoder.wasm`, `encoder-meta.json`, `wasm_exec.js`, and `encoder-worker.js` must remain a matching set. Serve WebAssembly as `application/wasm`. The source repository and license links stay available in the UI.

## License

GPL-3.0-or-later, with upstream attribution in [NOTICE](NOTICE). Corresponding source, build scripts, and the full license are provided. Third-party runtimes and libraries retain their own licenses.
