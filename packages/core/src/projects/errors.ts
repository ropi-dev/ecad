import { Data, Predicate } from "effect";

/** A project file changed on disk after the open project read or wrote it. */
export class ProjectConflict extends Data.TaggedError("ProjectConflict")<{
	/** The project-relative path that differs from the loaded copy. */
	readonly path: string;
	readonly message: string;
}> {
	constructor({ path }: { path: string }) {
		super({
			path,
			message:
				"The project changed on disk after it was opened. Reload it from disk before saving.",
		});
	}
}

/** The caller refers to a project that is not the one currently open. */
export class ProjectClosed extends Data.TaggedError("ProjectClosed")<{
	readonly message: string;
}> {
	constructor() {
		super({ message: "This project is no longer open." });
	}
}

export class ProjectExists extends Data.TaggedError("ProjectExists")<{
	// `name` would replace Error.name.
	readonly projectName?: string;
	readonly message: string;
}> {
	constructor({ projectName }: { projectName?: string } = {}) {
		super({
			...(projectName === undefined ? {} : { projectName }),
			message:
				projectName === undefined
					? "This directory already contains an ECAD project."
					: "A project with this name already exists.",
		});
	}
}

/** A file listed by the project is missing, unreadable as JSON, or fails validation. */
export class InvalidProjectFile extends Data.TaggedError("InvalidProjectFile")<{
	readonly path: string;
	/** A sentence for people, never raw schema output. */
	readonly reason: string;
	readonly message: string;
	readonly cause?: unknown;
}> {
	constructor({
		path,
		reason,
		cause,
	}: {
		path: string;
		reason: string;
		cause?: unknown;
	}) {
		super({
			path,
			reason,
			message: `The project file "${path}" is invalid. ${reason}`,
			...(cause === undefined ? {} : { cause }),
		});
	}
}

/** The document passed to `save` breaks a project rule. Nothing was written. */
export class InvalidProjectDocument extends Data.TaggedError(
	"InvalidProjectDocument",
)<{
	readonly reason: string;
	readonly message: string;
	readonly cause?: unknown;
}> {
	constructor({ reason, cause }: { reason: string; cause?: unknown }) {
		super({
			reason,
			message: reason,
			...(cause === undefined ? {} : { cause }),
		});
	}
}

/** A path is outside the project, a link, or not the expected kind of entry. */
export class InvalidProjectPath extends Data.TaggedError("InvalidProjectPath")<{
	readonly path: string;
	readonly reason: string;
	readonly message: string;
}> {
	constructor({ path, reason }: { path: string; reason: string }) {
		super({ path, reason, message: reason });
	}
}

export class InvalidProjectName extends Data.TaggedError("InvalidProjectName")<{
	readonly projectName: string;
	readonly reason: string;
	readonly message: string;
}> {
	constructor({
		projectName,
		reason,
	}: { projectName: string; reason: string }) {
		super({ projectName, reason, message: reason });
	}
}

export class ProjectAssetNotFound extends Data.TaggedError(
	"ProjectAssetNotFound",
)<{
	readonly path: string;
	readonly message: string;
}> {
	constructor({ path }: { path: string }) {
		super({
			path,
			message: "This asset does not belong to the open project.",
		});
	}
}

export class ProjectStorageUnavailable extends Data.TaggedError(
	"ProjectStorageUnavailable",
)<{
	readonly message: string;
}> {
	constructor() {
		super({
			message:
				"Project directories are unavailable in this browser. Use a browser with local filesystem storage support.",
		});
	}
}

/** A save failed and undoing its partial writes failed too. */
export class ProjectRollbackFailed extends Data.TaggedError(
	"ProjectRollbackFailed",
)<{
	readonly message: string;
	readonly cause?: unknown;
}> {
	constructor({ cause }: { cause?: unknown } = {}) {
		super({
			message: "Save failed and some project files could not be restored.",
			...(cause === undefined ? {} : { cause }),
		});
	}
}

/** The open project may not read or write this symbol library directory. */
export class SymbolLibraryAccessDenied extends Data.TaggedError(
	"SymbolLibraryAccessDenied",
)<{
	readonly path: string;
	readonly reason: string;
	readonly message: string;
}> {
	constructor({ path, reason }: { path: string; reason: string }) {
		super({ path, reason, message: reason });
	}
}

export type ProjectError =
	| ProjectConflict
	| ProjectClosed
	| ProjectExists
	| InvalidProjectFile
	| InvalidProjectDocument
	| InvalidProjectPath
	| InvalidProjectName
	| ProjectAssetNotFound
	| ProjectStorageUnavailable
	| ProjectRollbackFailed
	| SymbolLibraryAccessDenied;

export type ProjectErrorTag = ProjectError["_tag"];

/** Checks the tag, so errors rebuilt after crossing a process boundary match too. */
export function isProjectError<Tag extends ProjectErrorTag>(
	cause: unknown,
	tag: Tag,
): cause is Extract<ProjectError, { _tag: Tag }> {
	return Predicate.isTagged(cause, tag);
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * The tag and identifying fields of a project error, safe to send between
 * processes. Causes and stacks are left out. Other values return undefined.
 */
export function projectErrorData(
	cause: unknown,
): Record<string, string> | undefined {
	if (!reviveProjectError(cause)) return undefined;
	const fields = cause as Record<string, unknown>;
	const data: Record<string, string> = { _tag: text(fields._tag) };
	for (const key of ["path", "reason", "projectName"])
		if (typeof fields[key] === "string") data[key] = fields[key];
	return data;
}

/** Rebuilds a project error from its tag and fields, for example after IPC. */
export function reviveProjectError(value: unknown): ProjectError | undefined {
	if (!Predicate.hasProperty(value, "_tag")) return undefined;
	const fields = value as Record<string, unknown>;
	switch (value._tag) {
		case "ProjectConflict":
			return new ProjectConflict({ path: text(fields.path) });
		case "ProjectClosed":
			return new ProjectClosed();
		case "ProjectExists":
			return new ProjectExists(
				typeof fields.projectName === "string"
					? { projectName: fields.projectName }
					: {},
			);
		case "InvalidProjectFile":
			return new InvalidProjectFile({
				path: text(fields.path),
				reason: text(fields.reason),
			});
		case "InvalidProjectDocument":
			return new InvalidProjectDocument({ reason: text(fields.reason) });
		case "InvalidProjectPath":
			return new InvalidProjectPath({
				path: text(fields.path),
				reason: text(fields.reason),
			});
		case "InvalidProjectName":
			return new InvalidProjectName({
				projectName: text(fields.projectName),
				reason: text(fields.reason),
			});
		case "ProjectAssetNotFound":
			return new ProjectAssetNotFound({ path: text(fields.path) });
		case "ProjectStorageUnavailable":
			return new ProjectStorageUnavailable();
		case "ProjectRollbackFailed":
			return new ProjectRollbackFailed();
		case "SymbolLibraryAccessDenied":
			return new SymbolLibraryAccessDenied({
				path: text(fields.path),
				reason: text(fields.reason),
			});
	}
	return undefined;
}

/** One readable sentence from a schema failure, without Zod's JSON dump. */
export function schemaReason(
	issues: readonly { path: readonly PropertyKey[]; message: string }[],
	limit = 3,
): string {
	const messages = [
		...new Set(
			issues.map((issue) =>
				issue.path.length
					? `${issue.path.map(String).join(".")}: ${issue.message}`
					: issue.message,
			),
		),
	];
	const shown = messages.slice(0, limit).join("; ");
	const hidden = messages.length - limit;
	return hidden > 0
		? `${shown}; and ${hidden} more ${hidden === 1 ? "problem" : "problems"}.`
		: /[.!?]$/.test(shown)
			? shown
			: `${shown}.`;
}
