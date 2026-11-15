import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, lstat, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { pipeline } from "node:stream/promises";
import { createZstdDecompress } from "node:zlib";
import { z } from "zod";

const segmentPattern = /^[\w@+~.-]+$/;

export function isPackagePath(path: string) {
	const segments = path.split("/");
	return (
		segments[0] === "usr" &&
		segments.every(
			(segment) =>
				segmentPattern.test(segment) && segment !== "." && segment !== "..",
		)
	);
}

const packagePath = z.string().max(4096).refine(isPackagePath, {
	message: "The path leaves the package's usr directory.",
});
const count = z.number().int().nonnegative();

const fileSchema = z.object({
	path: packagePath,
	mode: z
		.number()
		.int()
		.refine((mode) => [0o644, 0o755, 0o4755].includes(mode)),
	size: count,
	sha256: z.string().regex(/^[0-9a-f]{64}$/),
	offset: count,
	length: z.number().int().positive(),
});

export type PackageFile = z.infer<typeof fileSchema>;

const manifestSchema = z
	.object({
		format: z.literal(1),
		version: z.string(),
		architecture: z.string(),
		control: z.string().max(64 * 1024),
		md5sums: z.string().max(1024 * 1024),
		directories: z.array(packagePath).max(20_000),
		files: z.array(fileSchema).max(20_000),
		links: z
			.array(z.object({ path: packagePath, target: z.string().max(4096) }))
			.max(1000),
	})
	.refine(
		({ directories, files, links }) => {
			const paths = [
				...directories,
				...files.map(({ path }) => path),
				...links.map(({ path }) => path),
			];
			return new Set(paths).size === paths.length;
		},
		{ message: "The manifest lists a path twice." },
	)
	.refine(
		({ links }) =>
			links.every(
				({ path, target }) =>
					!target.startsWith("/") &&
					isPackagePath(
						posix.normalize(posix.join(posix.dirname(path), target)),
					),
			),
		{ message: "A link points outside the package's usr directory." },
	);

export type PackageManifest = z.infer<typeof manifestSchema>;

export function parsePackageManifest(
	value: unknown,
	expected: { version: string; architecture: string; packSize: number },
): PackageManifest {
	const parsed = manifestSchema.safeParse(value);
	if (!parsed.success)
		throw new Error("The update manifest is not valid.", {
			cause: parsed.error,
		});
	const manifest = parsed.data;
	if (
		manifest.version !== expected.version ||
		manifest.architecture !== expected.architecture
	)
		throw new Error("The update manifest is for another package.");
	if (
		manifest.files.some(
			({ offset, length }) => offset + length > expected.packSize,
		)
	)
		throw new Error("The update manifest points past the end of its pack.");
	return manifest;
}

function hashing(hash: ReturnType<typeof createHash>, limit: number) {
	let size = 0;
	return async function* (chunks: AsyncIterable<Buffer>) {
		for await (const chunk of chunks) {
			size += chunk.byteLength;
			if (size > limit) throw new Error("The update file is too large.");
			hash.update(chunk);
			yield chunk;
		}
	};
}

async function copyIfUnchanged(
	source: string,
	target: string,
	file: PackageFile,
) {
	const info = await lstat(source).catch(() => null);
	if (!info?.isFile() || info.size !== file.size) return false;
	const hash = createHash("sha256");
	try {
		await pipeline(
			createReadStream(source),
			hashing(hash, file.size),
			createWriteStream(target, { flags: "wx", mode: 0o600 }),
		);
	} catch {
		await rm(target, { force: true });
		return false;
	}
	if (hash.digest("hex") === file.sha256) return true;
	await rm(target, { force: true });
	return false;
}

/** @return the files still to download. */
export async function stageInstalledFiles(
	manifest: PackageManifest,
	installedRoot: string,
	tree: string,
): Promise<PackageFile[]> {
	await mkdir(tree, { recursive: true });
	for (const directory of manifest.directories)
		await mkdir(join(tree, directory), { recursive: true });
	for (const { path } of [...manifest.files, ...manifest.links])
		await mkdir(join(tree, posix.dirname(path)), { recursive: true });
	const missing: PackageFile[] = [];
	for (const file of manifest.files)
		if (
			!(await copyIfUnchanged(
				join(installedRoot, file.path),
				join(tree, file.path),
				file,
			))
		)
			missing.push(file);
	return missing;
}

export async function writePackedFile(
	chunks: AsyncIterable<Uint8Array>,
	file: PackageFile,
	path: string,
) {
	const hash = createHash("sha256");
	await pipeline(
		chunks,
		createZstdDecompress(),
		hashing(hash, file.size),
		createWriteStream(path, { flags: "wx", mode: 0o600 }),
	);
	if (hash.digest("hex") !== file.sha256)
		throw new Error(
			`The update file ${file.path} does not match its checksum.`,
		);
}

export async function finishTree(manifest: PackageManifest, tree: string) {
	for (const { path, target } of manifest.links)
		await symlink(target, join(tree, path));
	const control = join(tree, "DEBIAN");
	await mkdir(control);
	await writeFile(join(control, "control"), manifest.control);
	await writeFile(join(control, "md5sums"), manifest.md5sums);
	for (const name of ["control", "md5sums"])
		await chmod(join(control, name), 0o644);
	for (const directory of [
		tree,
		control,
		...manifest.directories.map((path) => join(tree, path)),
	])
		await chmod(directory, 0o755);
	for (const { path, mode } of manifest.files)
		await chmod(join(tree, path), mode);
}

export function buildPackage(tree: string, path: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			"/usr/bin/dpkg-deb",
			["--root-owner-group", "-Zgzip", "-z1", "--build", tree, path],
			{ stdio: ["ignore", "ignore", "pipe"] },
		);
		let output = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			output = (output + chunk).slice(-4000);
		});
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0
				? resolve()
				: reject(
						new Error(
							`dpkg-deb could not build the update (exit code ${code}). ${output.trim()}`,
						),
					),
		);
	});
}
