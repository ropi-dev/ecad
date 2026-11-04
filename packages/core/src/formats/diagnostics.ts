import type { Diagnostic, DiagnosticSeverity } from "#/engine/types.ts";

export const asSentence = (text: string) =>
	/[.!?]$/.test(text) ? text : `${text}.`;
const asClause = (text: string) => text.replace(/\.$/, "");

/** Prefixes the source line when the parser knows it. */
export function formatDiagnostic({ line, message }: Diagnostic) {
	return line === undefined ? message : `Line ${line}: ${message}`;
}

const total = (diagnostics: readonly Diagnostic[]) =>
	diagnostics.reduce((sum, { count }) => sum + (count ?? 1), 0);

/** Lists the first few diagnostics and counts the rest, for one-line messages. */
export function summarizeDiagnostics(
	diagnostics: readonly Diagnostic[],
	limit = 3,
) {
	const shown = diagnostics
		.slice(0, limit)
		.map((diagnostic) => asClause(formatDiagnostic(diagnostic)));
	const more = total(diagnostics.slice(limit));
	if (more > 0)
		shown.push(
			`and ${more.toLocaleString()} more ${more === 1 ? "problem" : "problems"}`,
		);
	return shown.join("; ");
}

export function countDiagnostics(diagnostics: readonly Diagnostic[]) {
	const counts: Record<DiagnosticSeverity, number> = {
		warning: 0,
		error: 0,
		fatal: 0,
	};
	for (const { severity, count } of diagnostics) counts[severity] += count ?? 1;
	return counts;
}

/** "1 error, 2 warnings" for the problems a rendered layer still has. */
export function describeDiagnostics(diagnostics: readonly Diagnostic[]) {
	const { error, warning } = countDiagnostics(diagnostics);
	return [
		error && `${error.toLocaleString()} ${error === 1 ? "error" : "errors"}`,
		warning &&
			`${warning.toLocaleString()} ${warning === 1 ? "warning" : "warnings"}`,
	]
		.filter(Boolean)
		.join(", ");
}
