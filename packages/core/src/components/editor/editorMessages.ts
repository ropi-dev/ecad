export function editorIssues(
	sources: readonly (string | undefined)[],
): string[] {
	return [...new Set(sources.filter((issue): issue is string => !!issue))];
}

export function visibleEditorMessages(
	commandError: string,
	issues: readonly string[],
	dismissed: ReadonlySet<string>,
): string[] {
	return editorIssues([
		commandError,
		...issues.filter((issue) => !dismissed.has(issue)),
	]);
}

export function dismissEditorIssues(
	dismissed: ReadonlySet<string>,
	issues: readonly string[],
): ReadonlySet<string> {
	return new Set([...dismissed, ...issues]);
}

export function retainDismissedIssues(
	dismissed: ReadonlySet<string>,
	issues: readonly string[],
): ReadonlySet<string> {
	const retained = issues.filter((issue) => dismissed.has(issue));
	return retained.length === dismissed.size ? dismissed : new Set(retained);
}
