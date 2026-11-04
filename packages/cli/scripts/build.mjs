import { rm } from "node:fs/promises";
import { build } from "esbuild";
import { writeDistributionLicenses } from "../../../scripts/distribution-licenses.ts";

await rm("dist", { recursive: true, force: true });

await build({
	entryPoints: ["src/main.ts"],
	outdir: "dist",
	entryNames: "ecad",
	bundle: true,
	splitting: true,
	external: [
		"@modelcontextprotocol/sdk/*",
		"effect",
		"effect/*",
		"zod",
		"zod/*",
	],
	platform: "node",
	format: "esm",
	target: "node24",
	logLevel: "info",
});

await writeDistributionLicenses("cli", "dist");
