# ECAD in Rust

This Cargo workspace reimplements the TypeScript app in Rust. It reads and writes the same files as the TypeScript app: `.ecadprj`, `.ecaddraw`, `.ecadcircuit`, `.ecadpcb`, `.ecadsym`, `.ecadfp`, the `.history.json` next to a CLI drawing, and the global `settings.json`. The desktop app is native, and the web app is the same egui app compiled to WebAssembly.

| Crate | Ports | Contents |
| --- | --- | --- |
| `ecad-json` | `JSON.stringify` | Writes JSON byte for byte as JavaScript does, so saved files diff cleanly against files the TypeScript app wrote. |
| `ecad-drawing` | `packages/drawing-core` | Drawing model, schemas, commands, store, history, circuits, ERC, footprints, board netlist, connectivity, DRC, autorouter and the MCP drawing tools. |
| `ecad-geometry` | `clipper-lib`, `earcut`, `packages/core/src/engine/planar-*` | Polygon clipping and offsetting, triangulation and planar object geometry. |
| `ecad-formats` | `packages/core/src/formats` | Gerber and ZIP import, layer detection and order, KiCad schematic import. |
| `ecad-step` | `occt-import-js` | STEP import to triangle meshes. |
| `ecad-board` | `packages/core/src/board`, `packages/core/src/footprint` | Board file format, zone fills, Gerber and Excellon export, board objects. |
| `ecad-export` | `packages/core/src/drawing` | Display model, worksheet, theme, text layout, SVG, PNG and PDF export. |
| `ecad-project` | `packages/core/src/projects`, `settings`, `symbol-library` | Project manifest, repository, autosave, settings and symbol library configuration. |
| `ecad-symbols` | `packages/default-symbols` | The 45 built-in symbols. |
| `ecad-footprints` | `packages/default-footprints` | The 56 built-in footprints. |
| `ecad-models` | `packages/default-models` | The built-in 3D models, read from the same GLB files. |
| `ecad-app` | `packages/core/src/components`, `engine` | The egui editor, viewers and renderer shared by desktop and web. |
| `ecad-cli` | `packages/cli` | The `ecad` command and its MCP stdio server. |
| `ecad-desktop` | `packages/desktop` | The native app: filesystem projects, MCP endpoint, settings directory and updates. |
| `ecad-web` | `packages/web` | The WebAssembly app: browser projects and storage. |

## Build and test

Install Rust with [rustup](https://rustup.rs). The toolchain file selects stable Rust with the WebAssembly target.

```bash
cd rust
cargo test --workspace
cargo run -p ecad-cli -- tools
cargo run -p ecad-desktop --release -- /absolute/project-directory
```

Parity tests compare the Rust output with the TypeScript implementation for the same input. They run the TypeScript side through `tsx`, so they need the pnpm install at the repository root. Without it they are skipped.
