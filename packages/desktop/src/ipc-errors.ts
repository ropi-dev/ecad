import {
	projectErrorData,
	reviveProjectError,
} from "@ecad/core/projects/errors.ts";

const marker = "ecad-project-error:";
const remotePrefix =
	/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/;

export function encodeIpcError(cause: unknown): unknown {
	const data = projectErrorData(cause);
	return data ? new Error(`${marker}${JSON.stringify(data)}`) : cause;
}

export function decodeIpcError(cause: unknown): unknown {
	if (!(cause instanceof Error)) return cause;
	const index = cause.message.indexOf(marker);
	if (index >= 0) {
		try {
			const revived = reviveProjectError(
				JSON.parse(cause.message.slice(index + marker.length)),
			);
			if (revived) return revived;
		} catch {}
	}
	const message = cause.message.replace(remotePrefix, "");
	return message === cause.message ? cause : new Error(message, { cause });
}

export function decodeIpcErrors<Args extends unknown[], Result>(
	call: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
	return (...args) =>
		call(...args).catch((cause: unknown) => {
			throw decodeIpcError(cause);
		});
}
