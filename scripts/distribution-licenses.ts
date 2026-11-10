import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const sha256 = (data: Uint8Array | string) =>
	createHash("sha256").update(data).digest("hex");

type LicenseOverride = { files: string[]; source: string };

async function optionalFile(path: string) {
	try {
		return await readFile(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

async function dependencyDirectory(name: string, parent: string) {
	const require = createRequire(join(parent, "package.json"));
	for (const directory of require.resolve.paths(`${name}/package.json`) ?? []) {
		const candidate = join(directory, name);
		if (await optionalFile(join(candidate, "package.json")))
			return realpath(candidate);
	}
	return undefined;
}

async function dependencyNotices(workspace: string) {
	const seen = new Set<string>();
	const notices = new Map<string, string>();
	const overrides: Record<string, LicenseOverride> = JSON.parse(
		await readFile(join(root, "licenses/dependency-overrides.json"), "utf8"),
	);
	async function visit(directory: string) {
		if (seen.has(directory)) return;
		seen.add(directory);
		const pkg = JSON.parse(
			await readFile(join(directory, "package.json"), "utf8"),
		);
		if (!pkg.name.startsWith("@ecad/")) {
			const files = (await readdir(directory, { withFileTypes: true }))
				.filter(
					(file) =>
						file.isFile() &&
						/^(licen[cs]e|copying|notice)(\.|$|-)/i.test(file.name),
				)
				.map((file) => file.name)
				.sort();
			const identifier = `${pkg.name}@${pkg.version}`;
			const override =
				overrides[identifier] ??
				Object.entries(overrides).find(([pattern]) => {
					const [prefix, suffix] = pattern.split("*");
					return (
						suffix !== undefined &&
						identifier.startsWith(prefix) &&
						identifier.endsWith(suffix)
					);
				})?.[1];
			if (!files.length && !override)
				throw new Error(`Missing license text for ${pkg.name}@${pkg.version}`);
			const texts = files.length
				? await Promise.all(
						files.map(
							async (file) =>
								`${file}\n\n${await readFile(join(directory, file), "utf8")}`,
						),
					)
				: await Promise.all(
						override.files.map(
							async (file: string) =>
								`${file}\nSource: ${override.source}\n\n${await readFile(join(root, "licenses/dependencies", file), "utf8")}`,
						),
					);
			notices.set(`${pkg.name}@${pkg.version}`, texts.join("\n\n"));
		}
		const required = new Set(Object.keys(pkg.dependencies ?? {}));
		for (const name of Object.keys(pkg.optionalDependencies ?? {}))
			required.delete(name);
		const names = new Set([
			...required,
			...Object.keys(pkg.optionalDependencies ?? {}),
			...Object.keys(pkg.peerDependencies ?? {}),
		]);
		for (const name of names) {
			const dependency = await dependencyDirectory(name, directory);
			if (dependency) await visit(dependency);
			else if (required.has(name))
				throw new Error(`Missing dependency ${name} of ${pkg.name}`);
		}
	}
	await visit(await realpath(join(root, "packages", workspace)));
	return [...notices]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, text]) => `${name}\n${"=".repeat(name.length)}\n\n${text}`)
		.join("\n\n");
}

export async function stepSourceAssets() {
	const manifest = JSON.parse(
		await readFile(join(root, "licenses/step-sources.json"), "utf8"),
	);
	const importer = await dependencyDirectory(
		"occt-import-js",
		join(root, "packages/core"),
	);
	if (!importer) throw new Error("Missing occt-import-js");
	const pkg = JSON.parse(
		await readFile(join(importer, "package.json"), "utf8"),
	);
	const wasm = await readFile(join(importer, "dist/occt-import-js.wasm"));
	const javascript = (
		await readFile(join(importer, "dist/occt-import-js.js"), "utf8")
	).replaceAll("\r\n", "\n");
	if (
		pkg.version !== manifest.version ||
		sha256(wasm) !== manifest.wasmSha256 ||
		sha256(javascript) !== manifest.javascriptSha256
	) {
		throw new Error(
			"STEP importer changed. Update and verify licenses/step-sources.json before distributing it.",
		);
	}
	const cache =
		process.env.ECAD_LICENSE_CACHE ?? join(tmpdir(), "ecad-license-sources");
	await mkdir(cache, { recursive: true });
	const assets = new Map<string, Uint8Array>();
	for (const archive of manifest.archives) {
		const path = join(cache, archive.filename);
		let data = await optionalFile(path);
		if (!data) {
			const response = await fetch(archive.url, {
				signal: AbortSignal.timeout(180_000),
			});
			if (!response.ok)
				throw new Error(
					`Source download failed: ${archive.url}, HTTP ${response.status}`,
				);
			data = Buffer.from(await response.arrayBuffer());
			if (sha256(data) !== archive.sha256)
				throw new Error(`Source checksum mismatch: ${archive.filename}`);
			const temporary = `${path}.${randomUUID()}.tmp`;
			await writeFile(temporary, data);
			await rename(temporary, path);
		}
		if (sha256(data) !== archive.sha256)
			throw new Error(`Source checksum mismatch: ${archive.filename}`);
		assets.set(`licenses/sources/${archive.filename}`, data);
	}
	return assets;
}

export async function distributionAssets(workspace: string) {
	const assets = new Map<string, string | Uint8Array>();
	const files = ["THIRD_PARTY_NOTICES.md", "licenses/tanstack-MIT.txt"];
	if (workspace !== "cli") {
		files.push(
			"packages/default-symbols/LICENSE.md",
			"packages/default-symbols/NOTICE.md",
			"packages/default-symbols/CC-BY-SA-4.0.txt",
			"licenses/occt-import-js-LGPL-2.1.txt",
			"licenses/OCCT-LGPL-2.1.txt",
			"licenses/OCCT-LGPL-EXCEPTION.txt",
		);
		for (const [name, data] of await stepSourceAssets()) assets.set(name, data);
		assets.set(
			"licenses/STEP-SOURCE.md",
			await readFile(join(root, "licenses/STEP-SOURCE.md"), "utf8"),
		);
		assets.set(
			"licenses/step-sources.json",
			await readFile(join(root, "licenses/step-sources.json"), "utf8"),
		);
	}
	const sections = await Promise.all(
		files.map(
			async (file) => `${file}\n\n${await readFile(join(root, file), "utf8")}`,
		),
	);
	assets.set("LICENSE.txt", await readFile(join(root, "LICENSE"), "utf8"));
	assets.set(
		"THIRD_PARTY_NOTICES.txt",
		`${sections.join("\n\n")}\n\nDependency license texts\n\n${await dependencyNotices(workspace)}\n`,
	);
	return assets;
}

export function distributionLicenses(workspace: string): Plugin {
	return {
		name: "ecad-distribution-licenses",
		apply: "build",
		applyToEnvironment: (environment) => environment.name === "client",
		async generateBundle() {
			for (const [fileName, source] of await distributionAssets(workspace)) {
				this.emitFile({ type: "asset", fileName, source });
			}
		},
	};
}

export async function writeDistributionLicenses(
	workspace: string,
	output: string,
) {
	for (const [name, data] of await distributionAssets(workspace)) {
		const path = resolve(output, name);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, data);
	}
}
