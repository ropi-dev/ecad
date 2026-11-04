import type { Diagnostic, DiagnosticSeverity } from "#/engine/types.ts";

/** Prefixes the source line when the parser knows it. */
export function formatDiagnostic({ line, message }: Diagnostic) {
	return line === undefined ? message : `Line ${line}: ${message}`;
}

/** Lists the first few diagnostics and counts the rest, for one-line messages. */
export function summarizeDiagnostics(
	diagnostics: readonly Diagnostic[],
	limit = 3,
) {
	const shown = diagnostics.slice(0, limit).map(formatDiagnostic);
	const more = diagnostics.length - shown.length;
	if (more > 0)
		shown.push(`and ${more} more ${more === 1 ? "problem" : "problems"}`);
	return shown.join("; ");
}

export function countDiagnostics(diagnostics: readonly Diagnostic[]) {
	const counts: Record<DiagnosticSeverity, number> = {
		warning: 0,
		error: 0,
		fatal: 0,
	};
	for (const { severity } of diagnostics) counts[severity]++;
	return counts;
}

/** "1 error, 2 warnings" for the problems a rendered layer still has. */
export function describeDiagnostics(diagnostics: readonly Diagnostic[]) {
	const { error, warning } = countDiagnostics(diagnostics);
	return [
		error && `${error} ${error === 1 ? "error" : "errors"}`,
		warning && `${warning} ${warning === 1 ? "warning" : "warnings"}`,
	]
		.filter(Boolean)
		.join(", ");
}
