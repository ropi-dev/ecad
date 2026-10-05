import { build } from "esbuild";

export async function buildElectron() {
	await build({
		entryPoints: ["src/main/main.ts", "src/main/preload.ts"],
		outdir: "dist",
		entryNames: "[name]",
		outExtension: { ".js": ".cjs" },
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node24",
		external: ["electron"],
		logLevel: "info",
	});
}
