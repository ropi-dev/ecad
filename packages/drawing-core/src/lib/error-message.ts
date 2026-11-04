/**
 * Returns the message of a thrown `Error`. Anything else, such as a thrown
 * string or a rejected non-error value, gets `fallback`, or the value
 * converted to a string when no fallback is given.
 */
export function errorMessage(cause: unknown, fallback?: string) {
	return cause instanceof Error ? cause.message : (fallback ?? String(cause));
}
