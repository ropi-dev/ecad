import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmod,
	cp,
	lstat,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/**
 * Builds `ecad_<version>_<arch>.deb`, which installs the desktop app and the
 * `ecad` CLI. The CLI runs on the Node.js runtime inside the app's Electron
 * binary, so the package needs no separate Node.js installation.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
export const installDirectory = "/usr/lib/ecad";

const debianArchitectures: Record<string, string> = {
	x64: "amd64",
	arm64: "arm64",
	armv7l: "armhf",
};

export function debianArchitecture(arch: string): string {
	const debian = debianArchitectures[arch];
	if (!debian)
		throw new Error(
			`Unsupported architecture ${arch}. Use one of: ${Object.keys(debianArchitectures).join(", ")}.`,
		);
	return debian;
}

/** Shared libraries the Electron binary links, by Debian package. */
export const dependencies = [
	"libasound2t64 | libasound2",
	"libatk-bridge2.0-0t64 | libatk-bridge2.0-0",
	"libatk1.0-0t64 | libatk1.0-0",
	"libatspi2.0-0t64 | libatspi2.0-0",
	"libc6",
	"libcairo2",
	"libcups2t64 | libcups2",
	"libdbus-1-3",
	"libexpat1",
	"libgbm1",
	"libgcc-s1",
	"libglib2.0-0t64 | libglib2.0-0",
	"libgtk-3-0t64 | libgtk-3-0",
	"libnspr4",
	"libnss3",
	"libpango-1.0-0",
	"libudev1",
	"libx11-6",
	"libxcb1",
	"libxcomposite1",
	"libxdamage1",
	"libxext6",
	"libxfixes3",
	"libxkbcommon0",
	"libxrandr2",
];

/**
 * A version that sorts by commit time, so each build upgrades the previous one:
 * `0.0.0+git20261106153000.fa42a8d`.
 */
export function packageVersion(base: string, commitTime: Date, commit: string) {
	const stamp = commitTime
		.toISOString()
		.replace(/\.\d+Z$/, "")
		.replace(/\D/g, "");
	return `${base}+git${stamp}.${commit}`;
}

export function controlFile(options: {
	version: string;
	architecture: string;
	installedSize: number;
	maintainer: string;
}) {
	return `${[
		"Package: ecad",
		`Version: ${options.version}`,
		`Architecture: ${options.architecture}`,
		`Maintainer: ${options.maintainer}`,
		`Installed-Size: ${options.installedSize}`,
		`Depends: ${dependencies.join(", ")}`,
		"Section: electronics",
		"Priority: optional",
		"Homepage: https://github.com/ropi-dev/ecad",
		"Description: Schematic editor with PCB and 3D model viewers",
		" ECAD draws schematics, checks their electrical rules, imports KiCad",
		" schematics, and views Gerber files and STEP models.",
		" .",
		" The package installs the desktop app as ecad-desktop and the drawing CLI",
		" and MCP stdio server as ecad.",
	].join("\n")}\n`;
}

export const cliLauncher = `#!/bin/sh
# Runs the ECAD CLI on the Node.js runtime bundled with the desktop app.
ELECTRON_RUN_AS_NODE=1 exec ${installDirectory}/ecad-desktop ${installDirectory}/cli/ecad.js "$@"
`;

const desktopEntry = `[Desktop Entry]
Type=Application
Name=ECAD
GenericName=Schematic Editor
Comment=Draw schematics and view Gerber files and STEP models
Exec=ecad-desktop
Terminal=false
Categories=Development;Electronics;Engineering;
StartupWMClass=ecad
`;

function git(...args: string[]) {
	const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
	if (result.status !== 0)
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	return result.stdout.trim();
}

function exec(command: string, args: string[], env = process.env) {
	const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env });
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(
			`${command} ${args.join(" ")} exited with ${result.status}`,
		);
}

function maintainer(env = process.env) {
	if (env.DEBFULLNAME && env.DEBEMAIL)
		return `${env.DEBFULLNAME} <${env.DEBEMAIL}>`;
	return "rolaca11 <rolaca11@users.noreply.github.com>";
}

async function files(directory: string): Promise<string[]> {
	const entries = await readdir(directory, {
		recursive: true,
		withFileTypes: true,
	});
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name))
		.sort();
}

/** Debian expects 0755 directories, 0644 files and 0755 executables. */
async function normalizeModes(directory: string) {
	await chmod(directory, 0o755);
	for (const entry of await readdir(directory, {
		recursive: true,
		withFileTypes: true,
	})) {
		const path = join(entry.parentPath, entry.name);
		if (entry.isDirectory()) await chmod(path, 0o755);
		else if (entry.isFile())
			await chmod(path, (await lstat(path)).mode & 0o111 ? 0o755 : 0o644);
	}
}

async function installedSize(directory: string) {
	let bytes = 0;
	for (const path of await files(directory)) bytes += (await lstat(path)).size;
	return Math.ceil(bytes / 1024);
}

async function md5sums(directory: string) {
	const lines = [];
	for (const path of await files(directory)) {
		const hash = createHash("md5")
			.update(await readFile(path))
			.digest("hex");
		lines.push(`${hash}  ${relative(directory, path)}`);
	}
	return `${lines.join("\n")}\n`;
}

async function main() {
	const { values } = parseArgs({
		options: {
			arch: { type: "string", default: process.arch },
			out: { type: "string", default: "dist/deb" },
			version: { type: "string" },
		},
	});
	const architecture = debianArchitecture(values.arch);
	if (spawnSync("dpkg-deb", ["--version"]).status !== 0)
		throw new Error("dpkg-deb is required. Install the dpkg package.");

	const desktop = join(root, "packages/desktop");
	const desktopPackage = JSON.parse(
		await readFile(join(desktop, "package.json"), "utf8"),
	);
	const electronVersion = JSON.parse(
		await readFile(join(desktop, "node_modules/electron/package.json"), "utf8"),
	).version;
	const commitTime = new Date(Number(git("log", "-1", "--format=%ct")) * 1000);
	const version =
		values.version ??
		packageVersion(
			desktopPackage.version,
			commitTime,
			git("rev-parse", "--short=7", "HEAD"),
		);

	const out = resolve(root, values.out);
	const work = join(out, `.work-${architecture}`);
	await rm(work, { recursive: true, force: true });
	await mkdir(work, { recursive: true });
	try {
		exec("pnpm", ["--filter", "@ecad/desktop", "run", "build"]);

		// The main process and renderer are bundled, so the app needs no
		// node_modules. Keep the name: it sets the app's data directory.
		const app = join(work, "app");
		await cp(join(desktop, "dist"), join(app, "dist"), { recursive: true });
		await writeFile(
			join(app, "package.json"),
			`${JSON.stringify(
				{
					name: desktopPackage.name,
					version: desktopPackage.version,
					private: true,
					main: desktopPackage.main,
					// Electron names the window class after this: StartupWMClass.
					desktopName: "ecad.desktop",
				},
				null,
				"\t",
			)}\n`,
		);
		const { packager } = await import("@electron/packager");
		const [packaged] = await packager({
			dir: app,
			out: join(work, "packager"),
			// Stage next to the output rather than in the system temp directory.
			tmpdir: join(work, "tmp"),
			name: "ecad",
			executableName: "ecad-desktop",
			platform: "linux",
			arch: values.arch as "x64" | "arm64" | "armv7l",
			electronVersion,
			asar: false,
			prune: false,
			overwrite: true,
			quiet: true,
		});

		const tree = join(work, "root");
		const lib = join(tree, installDirectory);
		await mkdir(join(lib, ".."), { recursive: true });
		await rename(packaged, lib);
		exec("node", [
			"packages/cli/scripts/build.mjs",
			"--standalone",
			"--outdir",
			join(lib, "cli"),
		]);

		const bin = join(tree, "usr/bin");
		await mkdir(bin, { recursive: true });
		await writeFile(join(bin, "ecad"), cliLauncher, { mode: 0o755 });
		await symlink(
			relative(bin, join(lib, "ecad-desktop")),
			join(bin, "ecad-desktop"),
		);
		const applications = join(tree, "usr/share/applications");
		await mkdir(applications, { recursive: true });
		await writeFile(join(applications, "ecad.desktop"), desktopEntry);
		const doc = join(tree, "usr/share/doc/ecad");
		await mkdir(doc, { recursive: true });
		await writeFile(
			join(doc, "copyright"),
			`${await readFile(join(root, "LICENSE"), "utf8")}
Third-party notices: ${installDirectory}/resources/app/dist/renderer/THIRD_PARTY_NOTICES.txt,
${installDirectory}/cli/THIRD_PARTY_NOTICES.txt, and the Chromium licenses in
${installDirectory}/LICENSES.chromium.html.
`,
		);

		await normalizeModes(tree);
		// Chromium falls back to its setuid sandbox where unprivileged user
		// namespaces are restricted, as on Ubuntu 24.04 and later.
		await chmod(join(lib, "chrome-sandbox"), 0o4755);

		const control = join(tree, "DEBIAN");
		await mkdir(control, { recursive: true });
		await writeFile(
			join(control, "control"),
			controlFile({
				version,
				architecture,
				installedSize: await installedSize(tree),
				maintainer: maintainer(),
			}),
		);
		await writeFile(join(control, "md5sums"), await md5sums(tree));
		await normalizeModes(control);

		const deb = join(out, `ecad_${version}_${architecture}.deb`);
		exec(
			"dpkg-deb",
			["--root-owner-group", "-Zxz", "--build", tree, deb],
			// dpkg-deb clamps file times to this, which makes builds reproducible.
			{
				...process.env,
				SOURCE_DATE_EPOCH: String(commitTime.getTime() / 1000),
			},
		);
		console.log(`Built ${relative(root, deb)}`);
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}

if (import.meta.main) await main();
