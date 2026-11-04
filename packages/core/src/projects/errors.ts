import { Data, Predicate } from "effect";

export class ProjectConflict extends Data.TaggedError("ProjectConflict")<{
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

export class ProjectClosed extends Data.TaggedError("ProjectClosed")<{
	readonly message: string;
}> {
	constructor() {
		super({ message: "This project is no longer open." });
	}
}

export class ProjectExists extends Data.TaggedError("ProjectExists")<{
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

export class InvalidProjectFile extends Data.TaggedError("InvalidProjectFile")<{
	readonly path: string;
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

/**
 * Another window or app holds the project lock. With a path, the lock names no
 * owner, so it may be left over and the user can remove that file.
 */
export class ProjectLocked extends Data.TaggedError("ProjectLocked")<{
	readonly path?: string;
	readonly message: string;
}> {
	constructor({ path }: { path?: string } = {}) {
		super({
			...(path === undefined ? {} : { path }),
			message:
				path === undefined
					? "Another window or app is using this project. Try again when it is done."
					: `This project is locked, but the lock does not say which app holds it. If no other window or app is using the project, delete the lock file "${path}" and try again.`,
		});
	}
}

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
	| ProjectLocked
	| ProjectRollbackFailed
	| SymbolLibraryAccessDenied;

export type ProjectErrorTag = ProjectError["_tag"];

export function isProjectError<Tag extends ProjectErrorTag>(
	cause: unknown,
	tag: Tag,
): cause is Extract<ProjectError, { _tag: Tag }> {
	return Predicate.isTagged(cause, tag);
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

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
		case "ProjectLocked":
			return new ProjectLocked(
				typeof fields.path === "string" ? { path: fields.path } : {},
			);
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
