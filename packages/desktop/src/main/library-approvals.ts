import { randomUUID } from "node:crypto";
import {
	lstat,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { createSerialQueue } from "@ecad/core/lib/serial-queue.ts";
import { z } from "zod";

export interface ExternalLibraryRequest {
	/** Real path of the open project, or its in-memory ID before it is saved. */
	project: string;
	/** Real path of the library directory outside the project. */
	directory: string;
}

const APPROVAL_LIMIT = 256;
const APPROVALS_FILE_LIMIT = 4 * 1024 * 1024;
const approvalSchema = z.strictObject({
	project: z.string().min(1).max(4096),
	directory: z.string().min(1).max(4096),
});
const approvalsSchema = z.strictObject({
	version: z.literal(1),
	approvals: z.array(approvalSchema).max(APPROVAL_LIMIT),
});

function same(left: ExternalLibraryRequest, right: ExternalLibraryRequest) {
	return left.project === right.project && left.directory === right.directory;
}

/**
 * Remembers which outside library directories the user let each project use.
 * Approvals live in the user's own ~/.ecad directory and never in a project,
 * so opening a downloaded project cannot approve its own paths.
 */
export class ExternalLibraryApprovals {
	readonly path: string;
	private session: ExternalLibraryRequest[] = [];
	private readonly sequential = createSerialQueue();

	constructor(
		private options: {
			homeDirectory?: string;
			/** Directories the user chose in a native dialog during this session. */
			chosen?(directory: string): boolean;
			/** Asks the user in a main-process dialog. */
			confirm?(request: ExternalLibraryRequest): Promise<boolean>;
		} = {},
	) {
		this.path = join(
			options.homeDirectory ?? homedir(),
			".ecad",
			"approved-libraries.json",
		);
	}

	/**
	 * Checks stored and session approvals. With `prompt: false`, the user is not
	 * asked, but a directory chosen in a native dialog since then still counts.
	 */
	approve(
		request: ExternalLibraryRequest,
		{ prompt = true }: { prompt?: boolean } = {},
	): Promise<boolean> {
		return this.sequential(async () => {
			if (this.session.some((entry) => same(entry, request))) return true;
			const stored = await this.read();
			if (stored.some((entry) => same(entry, request))) return true;
			if (
				!this.options.chosen?.(request.directory) &&
				!(prompt && (await this.options.confirm?.(request)))
			)
				return false;
			this.session.push(request);
			// An unsaved project has no stable path yet; its approval lasts for this session.
			if (isAbsolute(request.project))
				await this.write(
					[
						...stored.filter((entry) => !same(entry, request)),
						{ project: request.project, directory: request.directory },
					].slice(-APPROVAL_LIMIT),
				);
			return true;
		});
	}

	private async read(): Promise<ExternalLibraryRequest[]> {
		try {
			const metadata = await lstat(this.path);
			if (!metadata.isFile() || metadata.size > APPROVALS_FILE_LIMIT) return [];
			return approvalsSchema.parse(
				JSON.parse(await readFile(this.path, "utf8")),
			).approvals;
		} catch {
			// Missing or damaged approvals approve nothing, so the user is asked again.
			return [];
		}
	}

	private async write(approvals: ExternalLibraryRequest[]) {
		const contents = `${JSON.stringify({ version: 1, approvals })}\n`;
		const temporary = `${this.path}.${randomUUID()}.tmp`;
		try {
			await mkdir(dirname(this.path), { recursive: true });
			await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
			await rename(temporary, this.path);
		} catch {
			// The user already approved this directory. If the approval cannot be
			// saved, it still applies for this session and the next session asks again.
		} finally {
			await rm(temporary, { force: true });
		}
	}
}
