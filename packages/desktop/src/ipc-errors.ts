import {
	projectErrorData,
	reviveProjectError,
} from "@ecad/core/projects/errors.ts";

const marker = "ecad-project-error:";
// Electron rejects invoke() with `Error invoking remote method '<channel>': <String(error)>`.
const remotePrefix =
	/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/;

/**
 * Electron and the context bridge keep only an error's message. A project
 * error therefore travels as its tag and fields encoded in the message.
 */
export function encodeIpcError(cause: unknown): unknown {
	const data = projectErrorData(cause);
	return data ? new Error(`${marker}${JSON.stringify(data)}`) : cause;
}

/** Rebuilds a project error, or removes Electron's prefix from other messages. */
export function decodeIpcError(cause: unknown): unknown {
	if (!(cause instanceof Error)) return cause;
	const index = cause.message.indexOf(marker);
	if (index >= 0) {
		try {
			const revived = reviveProjectError(
				JSON.parse(cause.message.slice(index + marker.length)),
			);
			if (revived) return revived;
		} catch {
			// Fall through and show the message without the IPC prefix.
		}
	}
	const message = cause.message.replace(remotePrefix, "");
	return message === cause.message ? cause : new Error(message, { cause });
}

/** Wraps a bridge call so its rejections are decoded. */
export function decodeIpcErrors<Args extends unknown[], Result>(
	call: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
	return (...args) =>
		call(...args).catch((cause: unknown) => {
			throw decodeIpcError(cause);
		});
}
