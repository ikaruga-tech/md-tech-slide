# Release Candidate (RC) Verification Checklist

This document defines the formal acceptance testing checklist, environment matrix, verification procedures, severity classifications, and release decision criteria for Release Candidates of `md-tech-slide`.

## 1. Severity Classifications & Decision Criteria

| Severity Level | Definition                                                                                                                                              | Acceptance Criteria                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| P0 (Blocker)   | Critical functional failure: Data loss, crash, extension launch failure, inability to export PPTX/PDF, broken OpenXML structure, or security violation. | Exactly 0 items allowed. Must fix before release.                                  |
| P1 (Major)     | Important feature impaired, severe layout overflow, or font failure with known workaround.                                                              | Allowed only if clear workaround is documented and project owner approves release. |
| P2 (Minor)     | Minor visual glitch, cosmetic flaw, non-critical documentation typo.                                                                                    | Tracked for subsequent patch release.                                              |

## 2. Evaluation Metadata Record

| Metadata Item         | Entry / Record Value                                    |
| --------------------- | ------------------------------------------------------- |
| Target Release Tag    | (e.g. `v0.1.0-rc.1`)                                    |
| Target Commit SHA     | (e.g. 40-character git commit SHA)                      |
| Target VSIX Package   | (e.g. `md-tech-slide-0.1.0.vsix` with SHA-256 checksum) |
| Evaluator / Tester    | (Name or GitHub username)                               |
| Evaluation Timestamp  | (ISO 8601 UTC date/time)                                |
| Target Environment OS | (e.g. macOS 15.0 / Windows 11 / Ubuntu 24.04)           |
| Evaluator Decision    | `ACCEPTED` / `REJECTED` / `PENDING`                     |

## 3. Verification Items Matrix

> [!IMPORTANT]
> Automated CI test passes must NOT be used as a substitute for manual evaluation.
> Items in environments not currently available to the evaluator must be explicitly recorded as `NOT TESTED / PENDING` rather than marked as passed.

### 3.1 Clean Installation and Smoke Test

- [ ] VSIX installation: Install the VSIX package in a clean VS Code profile (`code --install-extension <vsix>`).
- [ ] Command availability: Confirm `md-tech-slide: Open Slide Preview`, `Export to PowerPoint`, and `Export to PDF` appear in the Command Palette.
- [ ] Preview launch: Open `examples/01.md` and verify the Webview slide preview renders without CSP errors in Developer Tools.
- [ ] Bidirectional sync: Editing Markdown line scrolls the preview; clicking preview navigates editor.

### 3.2 Microsoft PowerPoint Verification (Cross-OS)

#### macOS PowerPoint (Microsoft 365 / Standalone)

- [ ] File opening: `sample.pptx` opens without repair warnings or OpenXML corruption alerts.
- [ ] Native text editing: Headings, body text, and lists can be selected and edited as native text shapes.
- [ ] Native table editing: Tables are native PowerPoint tables with editable cells.
- [ ] Speaker notes: Speaker notes appear in the native PowerPoint notes pane and are editable.
- [ ] Vector diagrams: Mermaid diagrams appear as crisp vector shapes without raster pixelation.

#### Windows PowerPoint (Microsoft 365 / Standalone)

- [ ] File opening: Opens without warnings or repairs on Windows PowerPoint.
- [ ] Text & table editing: Confirmed editable natively.
- [ ] Speaker notes: Notes pane confirmed.
- [ ] Font rendering: Dual Latin/East Asian font mapping (`a:latin`, `a:ea`) resolves correctly.

### 3.3 Headless PDF Export Verification (Cross-OS)

- [ ] macOS: Export to PDF succeeds via detected system browser (Chrome/Edge); vector text and diagrams remain sharp when zoomed in.
- [ ] Windows: Export to PDF succeeds; Japanese fonts and layout bounds are preserved.
- [ ] Linux: Export to PDF succeeds in headless environment (Xvfb / Chromium).

### 3.4 Japanese Typography & Layout Overflow Evaluation

- [ ] Font substitution: When specified fonts are unavailable, fallback fonts render legibly without crashing.
- [ ] Visual overflow: Check for catastrophic text clipping or layout breakage in 2-column slides.
- [ ] Diagnostic warnings: Confirm overflow warning diagnostics appear in editor for intentional overflow slides.

## 4. Defect and Observation Log

| ID  | Slide / Feature | Environment | Severity | Observed Behavior     | Workaround / Decision |
| --- | --------------- | ----------- | -------- | --------------------- | --------------------- |
| -   | -               | -           | -        | No defects logged yet | -                     |

## 5. Summary & Sign-off

- Total P0 defects: 0
- Total P1 defects: 0
- Status of currently unavailable environments: Recorded as `PENDING / NOT TESTED`
- Recommendation: (Ready for RC tag / Pending resolution)
