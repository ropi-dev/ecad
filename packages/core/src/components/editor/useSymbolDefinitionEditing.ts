import type { EditorSymbol } from "@ecad/drawing-core/drawing/shapes.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { useEffect, useEffectEvent, useState } from "react";
import type { EditorSession } from "#/components/editor/editorSession.ts";
import type { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import { projectIndex } from "#/projects/project-index.ts";
import type { SymbolEditTarget } from "#/symbol-library/storage.tsx";

/**
 * Resolves how the selected symbol's definition can be edited: as a project
 * file opened in the workspace (`symbolPath`) or in place through a library
 * edit target.
 */
export function useSymbolDefinitionEditing({
	session,
	selectedSymbol,
	symbolLibrary,
}: {
	session: EditorSession;
	selectedSymbol: EditorSymbol | undefined;
	symbolLibrary: ReturnType<typeof useSymbolLibrary>;
}) {
	const [editTarget, setEditTarget] = useState<SymbolEditTarget | null>(null);
	const [editingDefinition, setEditingDefinition] =
		useState<SymbolEditTarget | null>(null);
	const symbolPath = useProjectSelection(({ project }) => {
		if (!project || !selectedSymbol) return undefined;
		if (
			selectedSymbol.library &&
			(selectedSymbol.library.scope !== "project" ||
				selectedSymbol.library.id !== "project-symbols")
		)
			return undefined;
		return projectIndex(project).symbolsById.get(selectedSymbol.definitionId)
			?.path;
	});

	const definitionId = selectedSymbol?.definitionId;
	const definitionLibrary = selectedSymbol?.library;
	const prepareEdit = useEffectEvent(symbolLibrary.prepareEdit);
	useEffect(() => {
		let active = true;
		setEditTarget(null);
		if (definitionId && !symbolLibrary.loading) {
			void prepareEdit(definitionId, definitionLibrary).then(
				(target) => {
					if (active) setEditTarget(target);
				},
				(cause) => {
					if (active)
						session.setError(
							errorMessage(cause, "Unable to open the symbol definition."),
						);
				},
			);
		}
		return () => {
			active = false;
		};
	}, [session, definitionId, definitionLibrary, symbolLibrary.loading]);
	return {
		definitionId,
		editTarget,
		editingDefinition,
		setEditingDefinition,
		symbolPath,
	};
}
