import {
	mkdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { lockDirectory, processStart } from "../development/common.ts";

/** Whether nothing listens on `127.0.0.1:port`. */
export function portAvailable(port: number): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "EADDRINUSE" || error.code === "EACCES")
				resolve(false);
			else reject(error);
		});
		server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
	});
}

interface Process {
	pid: number;
	start: string;
}

interface Recorded {
	/** The PID namespace: sandbox containers record PIDs the host cannot see. */
	namespace: string;
	/** The A/B run that started the server. */
	owner: Process;
	server: Process;
}

function pidNamespace(): string {
	try {
		return readlinkSync("/proc/self/ns/pid");
	} catch {
		return "unknown";
	}
}

function alive(entry: Process): boolean {
	return Boolean(entry.start) && processStart(entry.pid) === entry.start;
}

/**
 * Preview servers A/B runs started, one file per port next to the host
 * benchmark lock. A run killed outright leaves its detached servers holding
 * the ports, which would fail every other checkout's run. Any run holding the
 * exclusive lock can stop them once their owner is gone. Processes are
 * matched by PID and start time, so a reused PID is never stopped.
 */
export class ServerRecords {
	private readonly directory: string;
	private readonly owner: Process;
	private readonly namespace = pidNamespace();

	constructor(
		directory = join(lockDirectory(), "preview-servers"),
		owner: Process = {
			pid: process.pid,
			start: processStart(process.pid) ?? "",
		},
	) {
		this.directory = directory;
		this.owner = owner;
		mkdirSync(directory, { recursive: true, mode: 0o700 });
	}

	private file(port: number): string {
		return join(this.directory, `${port}.json`);
	}

	private read(port: number): Recorded | undefined {
		try {
			return JSON.parse(readFileSync(this.file(port), "utf8"));
		} catch {
			return undefined;
		}
	}

	add(pid: number, port: number): void {
		const start = processStart(pid);
		if (!start) return;
		const record: Recorded = {
			namespace: this.namespace,
			owner: this.owner,
			server: { pid, start },
		};
		writeFileSync(this.file(port), JSON.stringify(record));
	}

	/**
	 * Stops the server recorded on `port` if the run that started it is gone.
	 * Returns whether it stopped one. A live owner's server is left alone.
	 */
	stopLeftover(port: number): boolean {
		const record = this.read(port);
		if (!record || record.namespace !== this.namespace || alive(record.owner))
			return false;
		rmSync(this.file(port), { force: true });
		if (!alive(record.server)) return false;
		try {
			process.kill(-record.server.pid, "SIGTERM");
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
			throw error;
		}
	}

	/** Forgets this run's server on `port`. */
	release(port: number): void {
		const record = this.read(port);
		if (
			record?.namespace === this.namespace &&
			record.owner.pid === this.owner.pid &&
			record.owner.start === this.owner.start
		)
			rmSync(this.file(port), { force: true });
	}
}
