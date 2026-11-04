// Lock files that work across processes on one computer and recover from
// owners that exited without releasing them. Node only.
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
	link,
	lstat,
	open,
	readdir,
	readFile,
	readlink,
	rm,
} from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Data } from "effect";
import { z } from "zod";

export class FileLocked extends Data.TaggedError("FileLocked")<{
	readonly path: string;
	readonly message: string;
}> {
	constructor({ path }: { path: string }) {
		super({ path, message: `The file is locked by another process: ${path}` });
	}
}

const hasCode = (error: unknown, code: string) =>
	!!error &&
	typeof error === "object" &&
	"code" in error &&
	error.code === code;

// A replacement keeps the replaced file's mode, which the umask could narrow.
// A new file gets the default mode minus the umask. The mode is set after
// writing because a write clears the set-user-ID and set-group-ID bits.
export async function stageFile(
	path: string,
	content: string,
	mode?: number,
	temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`),
) {
	try {
		const handle = await open(temporary, "wx", mode ?? 0o666);
		try {
			await handle.writeFile(content);
			if (mode !== undefined) await handle.chmod(mode);
			await handle.sync();
		} finally {
			await handle.close();
		}
		return temporary;
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

const lockOwnerSchema = z.object({
	pid: z.number().int().positive(),
	hostname: z.string(),
	machineId: z.string().optional(),
	bootId: z.string().optional(),
	pidNamespace: z.string().optional(),
	startTime: z.string().optional(),
	id: z.uuid(),
});
type LockOwner = z.infer<typeof lockOwnerSchema>;

const readText = (path: string) =>
	readFile(path, "utf8").then(
		(text) => text.trim() || undefined,
		() => undefined,
	);

// Reports whether /proc describes this process's PID namespace. A namespace
// that kept its parent's /proc numbers the processes there differently.
let ownProc: Promise<boolean> | undefined;

function hasOwnProc() {
	ownProc ??=
		process.platform === "linux"
			? readlink("/proc/self").then(
					(pid) => pid === String(process.pid),
					() => false,
				)
			: Promise.resolve(false);
	return ownProc;
}

// The state and start time, in clock ticks since boot, of a process. The start
// time tells a process apart from a later one that reuses its PID.
async function processStatus(pid: number | "self") {
	if (!(await hasOwnProc())) return undefined;
	const status = await readText(`/proc/${pid}/stat`);
	if (!status) return undefined;
	// The command name in parentheses can contain spaces. The fields after it
	// start at field 3, the state, and field 22 is the start time.
	const fields = status.slice(status.lastIndexOf(")") + 2).split(" ");
	return { state: fields[0], startTime: fields[19] };
}

// Identifies this computer, boot and PID namespace where the system allows it.
let systemIdentity:
	| Promise<Omit<LockOwner, "pid" | "hostname" | "id">>
	| undefined;

function currentSystem() {
	systemIdentity ??= (async () => {
		if (process.platform !== "linux") return {};
		const [machineId, bootId, pidNamespace, status] = await Promise.all([
			readText("/etc/machine-id"),
			readText("/proc/sys/kernel/random/boot_id"),
			readlink("/proc/self/ns/pid").catch(() => undefined),
			processStatus("self"),
		]);
		return { machineId, bootId, pidNamespace, startTime: status?.startTime };
	})();
	return systemIdentity;
}

async function createLockOwner(): Promise<LockOwner> {
	return {
		pid: process.pid,
		hostname: hostname(),
		...(await currentSystem()),
		id: randomUUID(),
	};
}

// Reads a lock, claim or staged copy. Undefined means that the file is gone.
// Null means that it is not a small regular file this process can read. A FIFO
// would block and a symbolic link could point anywhere, so neither is opened.
const lockFileFlags =
	fsConstants.O_RDONLY |
	(fsConstants.O_NONBLOCK ?? 0) |
	(fsConstants.O_NOFOLLOW ?? 0);

async function readLockFile(path: string) {
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(path, lockFileFlags);
	} catch (error) {
		if (!hasCode(error, "ENOENT")) return null;
		// A dangling symbolic link still occupies the path where O_NOFOLLOW is
		// unavailable, so only a path that is really missing counts as gone.
		return (await lstat(path).then(
			() => true,
			() => false,
		))
			? null
			: undefined;
	}
	try {
		const info = await handle.stat();
		if (!info.isFile() || info.size > 4096) return null;
		return { content: await handle.readFile("utf8"), modified: info.mtimeMs };
	} catch {
		return null;
	} finally {
		await handle.close();
	}
}

const parseLockOwner = (content: string) => {
	try {
		return lockOwnerSchema.parse(JSON.parse(content));
	} catch {
		return null;
	}
};

// Undefined means that the file is gone. Null means that its owner is unknown,
// for example because another program wrote it.
async function readLockOwner(path: string) {
	const file = await readLockFile(path);
	return file && parseLockOwner(file.content);
}

// Returns true only when the owner certainly no longer runs. On Linux, a PID
// is checked only when both sides recorded the same boot and PID namespace.
// Other systems record no such IDs, so the host name identifies the computer.
async function hasExited(owner: LockOwner) {
	const local = { hostname: hostname(), ...(await currentSystem()) };
	if (owner.hostname !== local.hostname || owner.machineId !== local.machineId)
		return false;
	if (process.platform === "linux") {
		if (!owner.bootId || !local.bootId) return false;
		// Only a restart of the same computer changes its boot ID.
		if (owner.bootId !== local.bootId) return !!owner.machineId;
		if (!owner.pidNamespace || owner.pidNamespace !== local.pidNamespace)
			return false;
	} else if (owner.bootId || owner.pidNamespace) return false;
	try {
		process.kill(owner.pid, 0);
	} catch (error) {
		if (hasCode(error, "ESRCH")) return true;
		// Another user's process can reuse the PID too.
		if (!hasCode(error, "EPERM")) return false;
	}
	if (owner.startTime === undefined) return false;
	const status = await processStatus(owner.pid);
	if (!status) return false;
	// A zombie has exited and only waits for its parent to collect it.
	return status.state === "Z" || status.startTime !== owner.startTime;
}

const linkUnsupported = ["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"];

// Staged lock copies and claims have short names, so a long drawing name
// still fits. Owner IDs are unique, so drawings in one folder never collide.
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const lockCopyName = new RegExp(`^\\.ecad-lock-${uuid}\\.tmp$`);
const claimName = new RegExp(`^\\.ecad-claim-${uuid}$`);
const claimPath = (directory: string, owner: LockOwner) =>
	join(directory, `.ecad-claim-${owner.id}`);

// Creates the file at path with the owner's metadata unless the path exists.
// Linking a complete, synced copy publishes the metadata with the file, so a
// crash or power loss never leaves an empty lock. The copy is staged only when
// the path looks free, so a waiting process holds no copy.
async function createLockFile(path: string, owner: LockOwner) {
	const content = JSON.stringify(owner);
	for (let attempt = 1; ; attempt++) {
		try {
			await lstat(path);
			return false;
		} catch (error) {
			if (!hasCode(error, "ENOENT")) throw error;
		}
		const staged = await stageFile(
			path,
			content,
			0o600,
			join(dirname(path), `.ecad-lock-${randomUUID()}.tmp`),
		);
		try {
			await link(staged, path);
			return true;
		} catch (error) {
			if (hasCode(error, "EEXIST")) return false;
			// Recovery removes a copy that stayed incomplete for a minute, for
			// example while this process was paused, so stage it again.
			if (hasCode(error, "ENOENT") && attempt < 3) continue;
			if (!linkUnsupported.some((code) => hasCode(error, code))) throw error;
		} finally {
			await rm(staged, { force: true });
		}
		break;
	}
	// Without hard links, a crash before the write leaves an empty lock.
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(path, "wx", 0o600);
	} catch (error) {
		if (hasCode(error, "EEXIST")) return false;
		throw error;
	}
	try {
		await handle.writeFile(content);
	} finally {
		await handle.close();
	}
	return true;
}

// Removes the lock or claim at target if its owner has exited. Returns
// "removed" after removing an abandoned file, "gone" when the file vanished,
// and "kept" otherwise. Removing a file needs a claim named after its exited
// owner. Creating that claim exclusively lets only one process act on that
// file, and an owner ID is never reused, so a file that still has the owner's
// ID while the claim is held is still the abandoned file. An existing claim is
// either in use or abandoned in the same way, so the chain is followed until
// a file can be removed.
async function removeAbandonedFile(target: string, claimer: LockOwner) {
	const directory = dirname(target);
	const visited = new Set<string>();
	for (;;) {
		const current = await readLockOwner(target);
		if (current === undefined) return "gone";
		if (current === null || visited.has(current.id)) return "kept";
		if (!(await hasExited(current))) return "kept";
		visited.add(current.id);
		const claim = claimPath(directory, current);
		if (!(await createLockFile(claim, claimer))) {
			target = claim;
			continue;
		}
		try {
			const latest = await readLockOwner(target);
			if (latest?.id !== current.id)
				return latest === undefined ? "gone" : "kept";
			await rm(target, { force: true });
			return "removed";
		} finally {
			await rm(claim, { force: true });
		}
	}
}

// Removes what killed processes leave beside locks. A claim whose owner exited
// goes through the same claim protocol, because another process may create a
// claim with that name again. A complete staged copy is removed once its owner
// has exited. Staging takes moments, so a readable but incomplete copy older
// than a minute is removed too, and a paused creator stages a new one.
async function removeLeftovers(directory: string, owner: LockOwner) {
	const names = await readdir(directory);
	await Promise.all(
		names.map(async (name) => {
			const path = join(directory, name);
			if (claimName.test(name)) {
				await removeAbandonedFile(path, { ...owner, id: randomUUID() });
				return;
			}
			if (!lockCopyName.test(name)) return;
			const file = await readLockFile(path);
			if (!file) return;
			const copyOwner = parseLockOwner(file.content);
			const abandoned = copyOwner
				? await hasExited(copyOwner)
				: Date.now() - file.modified > 60_000;
			if (abandoned) await rm(path, { force: true });
		}),
	);
}

export interface FileLockOptions {
	/** How long to wait for another owner, in milliseconds. */
	timeout: number;
	signal?: AbortSignal;
}

/**
 * Runs work while holding the lock file at lockPath. Waits for another owner
 * to release it, removes it if its owner exited, and throws FileLocked when
 * the timeout passes first.
 */
export async function withFileLock<T>(
	lockPath: string,
	{ timeout, signal }: FileLockOptions,
	work: () => Promise<T>,
) {
	const deadline = performance.now() + timeout;
	const owner = await createLockOwner();
	for (;;) {
		signal?.throwIfAborted();
		if (await createLockFile(lockPath, owner)) break;
		const recovery = await removeAbandonedFile(lockPath, {
			...owner,
			id: randomUUID(),
		});
		// After removing an abandoned file, try once more even past the deadline.
		if (recovery === "removed") {
			await removeLeftovers(dirname(lockPath), owner).catch(() => {});
			continue;
		}
		if (performance.now() >= deadline) throw new FileLocked({ path: lockPath });
		// A lock that vanished was just released, so retry at once.
		if (recovery === "kept") await delay(25, undefined, { signal });
	}
	try {
		signal?.throwIfAborted();
		return await work();
	} finally {
		await rm(lockPath, { force: true });
	}
}
