# Settings

Open **Settings** from the gear icon at the bottom of the sidebar. **Project → Symbol libraries...** opens the same dialog directly on the **Symbol libraries** section.

## Available settings

| Section | Setting | Global | Project | Availability |
| --- | --- | --- | --- | --- |
| Display | Theme (`System`, `Light`, `Dark`) | Yes | No | All builds |
| Display | Antialiasing (`Automatic`, `On`, `Off`) | Yes | No | All builds |
| Display | Show debug stats (`Ctrl+Shift+D`, default off) | Yes | No | All builds |
| Editor toolbar | Board & footprint units (`mm`, `mil`) | Yes | No | PCB & footprint editors |
| Electrical rules | ERC rule levels (`Error`, `Warning`, `Off` per rule) | Yes | Yes | All builds |
| Symbol libraries | Enabled libraries, embedded symbols, directories | User | Project | All builds |
| MCP | Claude Code & Codex stdio MCP configuration | Yes | No | Desktop app |
| Updates | Release channel (`Stable`, `Nightly`) | Yes | No | `.deb`-installed desktop app |
| Usage data | Send performance data (opt-in, default off) | Yes | No | Builds with `VITE_POSTHOG_KEY` |

For settings that support both scopes (ERC rule levels), project overrides merge rule by rule on top of global levels: **All projects** edits global defaults, and **This project** edits the active project.

## Theme

**System** tracks OS light/dark changes automatically; **Light** and **Dark** stay fixed. Theme changes recolor the UI and all canvases (schematic, symbol, footprint, PCB, circuit graph, Gerber, STEP) in place while preserving camera and selection. Drawing exports ignore UI theme and use their own background option.

- UI colors use `light-dark()` tokens in `packages/core/src/styles.css` controlled by `color-scheme`.
- Canvas palettes live in `packages/core/src/drawing/schematic-theme.ts` and are applied via `packages/core/src/settings/theme.ts` (`data-theme` on `<html>`). `tests/theme.test.ts` enforces token parity and at least 3:1 contrast against canvas paper.
- Web injects an inline script before first paint to prevent theme flash; desktop reads settings in Electron's main process before window creation and sets `nativeTheme.themeSource`.
- In light theme, unfocused Gerber layers use normal blending with a darker film tone instead of additive blending.

## Board units

The `mm`/`mil` toggle beside the **2D** button in the PCB and footprint toolbars switches rulers, grid snapping, cursor readout, Attributes fields, Board setup rules, and DRC messages between millimetres and mils (decimal mil steps: `1, 2, 10, 20, 100 mil`). The preference is saved globally as `boardUnit` and applies to both editors. Schematics keep their 50 mil (`1.27 mm`) grid.

## Storage and schema compatibility

Global settings are stored as UTF-8 JSON (`{"version": 1, ...}`) validated by `appSettingsSchema` in `packages/core/src/settings/schema.ts`:

- **Reads are lenient** — Unknown keys are preserved across saves, and an invalid field drops only that field (ERC levels drop only invalid individual rules).
- **Saves are strict** — Invalid values for known fields fail rather than silently dropping.
- **Keep `version` at `1`** — Add new settings as optional fields; changing `version` would cause older builds to reject and overwrite the file.

### Storage locations

- **Web** — `localStorage` under `ecad.settings.v1` (synced across tabs via `storage` events). If absent, legacy `ecad.antialias` is migrated on next save. Opt-in telemetry consent lives separately under `ecad.telemetry.v1` (see [docs/performance.md](performance.md#field-data)).
- **Desktop** — Platform config directory (`$XDG_CONFIG_HOME/ecad` or `~/.config/ecad` on Linux, `~/Library/Application Support/ecad` on macOS, `%APPDATA%\ecad` on Windows):
  - `settings.json` — Atomic writes with mode `0600`. Damaged files fall back to defaults with an error notice until saved.
  - `telemetry.json` — Standalone opt-in telemetry consent file.
  - `symbol-libraries.json` and `approved-libraries.json` — User symbol libraries and approved external project library directories. (Legacy `~/.ecad/` files are still read until replaced.)
- **Project settings** — Stored in the `[settings]` table of `.ecadprj` (for example `[settings.ercSeverity]`). Saving project settings rewrites only `.ecadprj` and enforces standard external-edit conflict checks.

```toml
[settings.ercSeverity]
unconnected-pin = "off"
similar-net-names = "error"
```
