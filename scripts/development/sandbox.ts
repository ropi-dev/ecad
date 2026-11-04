import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareArtifacts } from "./artifacts.ts";
import {
	capture,
	guardedCommandArgs,
	lockDirectory,
	runLocked,
	worktreeId,
} from "./common.ts";

const root = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
process.chdir(root);
const [command, ...forwarded] = process.argv.slice(2);
const commands = [
	"dev",
	"test",
	"test:browser",
	"perf",
	"perf:baseline",
	"perf:dev",
	"check",
	"typecheck",
	"shell",
	"build-image",
];
if (
	!command ||
	["help", "--help", "-h"].includes(command) ||
	!commands.includes(command)
) {
	console.log(`Usage: pnpm sandbox <${commands.join("|")}> [arguments]`);
	process.exit(!command || ["help", "--help", "-h"].includes(command) ? 0 : 1);
}
if (process.platform !== "linux")
	throw new Error(
		"The development sandbox requires a Linux host with rootless Podman.",
	);
const id = worktreeId(root);
const engine = process.env.ECAD_CONTAINER_ENGINE ?? "podman";
const recipe = join(root, "scripts/development/Containerfile");
const imageTag = `localhost/ecad-dev:${createHash("sha256")
	.update(readFileSync(recipe))
	.update(readFileSync(join(dirname(recipe), "entrypoint.sh")))
	.digest("hex")
	.slice(0, 16)}`;
if (command === "build-image") {
	process.exitCode = await runLocked("perf", engine, [
		"build",
		"--pull=missing",
		"--tag",
		imageTag,
		"--file",
		recipe,
		dirname(recipe),
	]);
} else {
	let image: string;
	try {
		image = capture(engine, [
			"image",
			"inspect",
			imageTag,
			"--format",
			"{{.Id}}",
		]);
	} catch (error) {
		throw new Error(
			`Cannot inspect the sandbox image with ${engine}: ${error instanceof Error ? error.message : String(error)}. Run pnpm sandbox build-image if the image is missing.`,
		);
	}
	const perf = command.startsWith("perf");
	const role = perf ? "perf" : "dev";
	const topology = capture("lscpu", ["--parse=CPU,CORE,SOCKET,ONLINE"])
		.split("\n")
		.filter((line) => !line.startsWith("#"))
		.map((line) => line.split(","));
	const cores = [
		...new Set(
			topology
				.filter((row) => row[3] === "Y")
				.map((row) => `${row[2]}:${row[1]}`),
		),
	];
	if (cores.length < 3)
		throw new Error(
			"At least three physical cores are required. Configure the sandbox on a larger host.",
		);
	const reserved = new Set(cores.slice(-2));
	const cpuList = topology
		.filter(
			(row) => row[3] === "Y" && reserved.has(`${row[2]}:${row[1]}`) === perf,
		)
		.map((row) => row[0])
		.join(",");
	const cpus = process.env.ECAD_DEV_CPUS ?? "2";
	const memory = process.env.ECAD_SANDBOX_MEMORY ?? (perf ? "8g" : "4g");
	const port =
		process.env.ECAD_DEV_PORT ??
		String(20000 + (Number.parseInt(id.slice(0, 6), 16) % 40000));
	if (!/^\d+$/.test(port) || Number(port) > 65535 || Number(port) < 1024)
		throw new Error("ECAD_DEV_PORT must be between 1024 and 65535.");
	const name = `ecad-${id}-${command.replaceAll(":", "-")}`;
	const lockDir = lockDirectory();
	const args = [
		"run",
		"--rm",
		"--init",
		"--userns=keep-id",
		"--name",
		name,
		"--memory",
		memory,
		"--memory-swap",
		memory,
		"--pids-limit",
		"1024",
		"--shm-size",
		"1g",
		"--volume",
		`${lockDir}:${lockDir}`,
		"--env",
		`ECAD_LOCK_DIR=${lockDir}`,
		"--env",
		`ECAD_SANDBOX_ROLE=${role}`,
		"--env",
		"ELECTRON_SKIP_BINARY_DOWNLOAD=1",
		"--env",
		"ECAD_SANDBOX=1",
		"--volume",
		`ecad-${id}-${role}-root-modules:/workspace/node_modules`,
		"--volume",
		"ecad-pnpm-store:/pnpm/store",
		"--env",
		`ECAD_WORKTREE_ID=${id}`,
	];
	for (const entry of readdirSync(join(root, "packages"), {
		withFileTypes: true,
	})) {
		if (entry.isDirectory() && !perf) {
			mkdirSync(join(root, "packages", entry.name, "node_modules"), {
				recursive: true,
			});
			args.push(
				"--volume",
				`ecad-${id}-${role}-${entry.name}-modules:/workspace/packages/${entry.name}/node_modules`,
			);
		}
	}
	for (const key of [
		"ECAD_PERF_CPU",
		"ECAD_PERF_RUNS",
		"ECAD_PERF_PORT",
		"ECAD_BROWSER_PORT",
	]) {
		if (process.env[key] !== undefined)
			args.push("--env", `${key}=${process.env[key]}`);
	}
	if (perf && process.env.ECAD_PERF_BASELINE_PATH) {
		const requested = process.env.ECAD_PERF_BASELINE_PATH;
		const baseline = resolve("/tmp/ecad-artifacts", requested);
		const fromArtifacts = relative("/tmp/ecad-artifacts", baseline);
		if (
			isAbsolute(requested) ||
			!fromArtifacts ||
			fromArtifacts === ".." ||
			fromArtifacts.startsWith("../")
		)
			throw new Error(
				"Sandbox ECAD_PERF_BASELINE_PATH must be relative to its artifact directory, without escaping it.",
			);
		args.push("--env", `ECAD_PERF_BASELINE_PATH=${baseline}`);
	}
	if (perf) {
		args.push("--tmpfs", "/workspace:rw,size=1g,mode=1777");
		mkdirSync(`/tmp/ecad/${id}/container-perf`, { recursive: true });
		args.push(
			"--volume",
			`${root}:/source:ro`,
			"--volume",
			`/tmp/ecad/${id}/container-perf:/tmp/ecad-artifacts`,
			"--env",
			"ECAD_ARTIFACT_DIR=/tmp/ecad-artifacts",
			"--env",
			"ECAD_PERF_LOCK_HELD=1",
			"--env",
			`ECAD_REVISION=${capture("git", ["rev-parse", "HEAD"])}`,
			"--env",
			`ECAD_PERF_ENVIRONMENT=${JSON.stringify({
				image,
				node: "24.22.1",
				host: createHash("sha256")
					.update(capture("cat", ["/etc/machine-id"]))
					.digest("hex")
					.slice(0, 12),
				cpus: cpuList,
				memory,
				parallelism: availableParallelism(),
			})}`,
		);
	} else {
		mkdirSync(join(root, "node_modules"), { recursive: true });
		const artifacts = prepareArtifacts();
		args.push(
			"--cpus",
			cpus,
			"--volume",
			`${root}:/workspace`,
			"--volume",
			`${artifacts}:${artifacts}`,
		);
	}
	if (command === "dev") {
		args.push("--publish", `127.0.0.1:${port}:3000`);
		if (process.env.ECAD_ALLOWED_HOSTS)
			args.push(
				"--env",
				`ECAD_ALLOWED_HOSTS=${process.env.ECAD_ALLOWED_HOSTS}`,
			);
		console.log(`[ecad] Dev URL http://127.0.0.1:${port}`);
	}
	if (process.stdin.isTTY) args.push("--interactive", "--tty");
	args.push(
		image,
		"taskset",
		"--cpu-list",
		cpuList,
		"bash",
		"/opt/ecad/entrypoint.sh",
		command,
		...forwarded,
	);
	console.log(
		`[ecad] ${name}, CPUs ${cpuList}, memory ${memory}${perf ? ", no CPU quota" : `, CPU quota ${cpus}`}.`,
	);
	console.log(
		`[ecad] Artifacts ${perf ? `/tmp/ecad/${id}/container-perf` : realpathSync(join(root, "perf-artifacts"))}`,
	);
	const heavy = !perf && command !== "dev" && command !== "shell";
	if (heavy)
		console.log(
			"[ecad] Waiting for shared validation access. Benchmarks need exclusive access.",
		);
	process.exitCode = await runLocked(
		perf ? "perf" : `worktree-${id}-${command.replaceAll(":", "-")}`,
		heavy ? "flock" : engine,
		heavy
			? [
					"--shared",
					"--no-fork",
					join(lockDir, "perf.lock"),
					...guardedCommandArgs(engine, args),
				]
			: args,
	);
}
