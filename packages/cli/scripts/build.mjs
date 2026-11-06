import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { writeDistributionLicenses } from "../../../scripts/distribution-licenses.ts";

const cli = fileURLToPath(new URL("../", import.meta.url));

/**
 * Builds the CLI into `outdir`, relative to the CLI package. A `standalone`
 * build also bundles the npm dependencies, so it runs without node_modules.
 */
export async function buildCli({ outdir = "dist", standalone = false } = {}) {
	outdir = resolve(cli, outdir);
	await rm(outdir, { recursive: true, force: true });
	await build({
		absWorkingDir: cli,
		entryPoints: ["src/main.ts"],
		outdir,
		entryNames: "ecad",
		bundle: true,
		splitting: true,
		external: standalone
			? []
			: ["@modelcontextprotocol/sdk/*", "effect", "effect/*", "zod", "zod/*"],
		// Bundled CommonJS dependencies call require, which ES modules lack.
		banner: standalone
			? {
					js: 'import { createRequire as __ecadCreateRequire } from "node:module"; const require = __ecadCreateRequire(import.meta.url);',
				}
			: undefined,
		platform: "node",
		format: "esm",
		target: "node24",
		logLevel: "info",
	});
	await writeDistributionLicenses("cli", outdir);
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: { outdir: { type: "string" }, standalone: { type: "boolean" } },
	});
	await buildCli(values);
}
