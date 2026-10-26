/** Library IDs are unique within their user or project scope. */
export interface SymbolLibraryReference {
	scope: "user" | "project";
	id: string;
}

export function symbolReferenceKey(
	library: SymbolLibraryReference,
	definitionId: string,
): string {
	return `${library.scope}:${library.id}:${definitionId}`;
}
