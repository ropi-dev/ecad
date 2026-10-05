import { build } from "vite";
import { buildElectron } from "./electron-build.mjs";

await buildElectron();
await build();
