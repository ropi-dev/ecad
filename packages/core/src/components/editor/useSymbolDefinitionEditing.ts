import type { EditorSymbol } from "@ecad/drawing-core/drawing/shapes.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	untrack,
} from "solid-js";
import type { EditorSession } from "#/components/editor/editorSession.ts";
import type { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import { projectIndex } from "#/projects/project-index.ts";
import type { SymbolEditTarget } from "#/symbol-library/storage.ts";

/**
 * Resolves how the selected symbol's definition can be edited: as a project
 * file opened in the workspace (`symbolPath`) or in place through a library
 * edit target.
 */
export function useSymbolDefinitionEditing(
	options: Accessor<{
		session: EditorSession;
		selectedSymbol: EditorSymbol | undefined;
		symbolLibrary: ReturnType<typeof useSymbolLibrary>;
	}>,
) {
	const [editTarget, setEditTarget] = createSignal<SymbolEditTarget | null>(
		null,
	);
	const [projectWritable, setProjectWritable] = createSignal(false);
	const [editingDefinition, setEditingDefinition] =
		createSignal<SymbolEditTarget | null>(null);
	const selectedSymbol = () => options().selectedSymbol;
	const symbolPath = useProjectSelection(({ project }) => {
		const symbol = selectedSymbol();
		if (!project || !symbol) return undefined;
		if (
			symbol.library &&
			(symbol.library.scope !== "project" ||
				symbol.library.id !== "project-symbols")
		)
			return undefined;
		return projectIndex(project).symbolsById.get(symbol.definitionId)?.path;
	});

	const definitionId = createMemo(() => selectedSymbol()?.definitionId);
	const definitionLibrary = createMemo(() => selectedSymbol()?.library);
	const symbolLibrary = createMemo(() => options().symbolLibrary);
	const libraryLoading = createMemo(() => symbolLibrary().loading);
	const session = createMemo(() => options().session);
	createEffect(
		() =>
			[
				session(),
				definitionId(),
				definitionLibrary(),
				libraryLoading(),
				symbolLibrary(),
			] as const,
		([currentSession, id, library, loading, symbols]) => {
			let active = true;
			setEditTarget(null);
			setProjectWritable(false);
			if (id && !loading) {
				void untrack(() =>
					Promise.all([
						symbols.prepareEdit(id, library),
						symbols.canWriteProject().catch(() => false),
					]),
				).then(
					([target, writable]) => {
						if (!active) return;
						setEditTarget(target);
						setProjectWritable(writable);
					},
					(cause) => {
						if (active)
							currentSession.setError(
								errorMessage(cause, "Unable to open the symbol definition."),
							);
					},
				);
			}
			return () => {
				active = false;
			};
		},
	);
	async function copyToProject() {
		const { session, selectedSymbol, symbolLibrary } = options();
		if (!selectedSymbol) return;
		try {
			const copied = await symbolLibrary.copyToProject(
				selectedSymbol.definitionId,
				selectedSymbol.library,
			);
			const current = session
				.drawing()
				.shapes.find((shape) => shape.id === selectedSymbol.id);
			if (
				current?.kind !== "symbol" ||
				current.definitionId !== selectedSymbol.definitionId
			)
				return;
			session.replace([{ ...current, ...copied }], "Copy symbol to project");
		} catch (cause) {
			session.setError(
				errorMessage(cause, "Unable to copy the symbol to the project."),
			);
		}
	}
	const canCopy = createMemo(() => {
		const symbol = selectedSymbol();
		return (
			!!symbol &&
			projectWritable() &&
			!editTarget() &&
			options().symbolLibrary.canCopyToProject(
				symbol.definitionId,
				symbol.library,
			)
		);
	});
	return {
		get copyToProject() {
			return canCopy() ? copyToProject : undefined;
		},
		get definitionId() {
			return definitionId();
		},
		get editTarget() {
			return editTarget();
		},
		get editingDefinition() {
			return editingDefinition();
		},
		setEditingDefinition: (target: SymbolEditTarget | null) =>
			setEditingDefinition(() => target),
		get symbolPath() {
			return symbolPath() ?? undefined;
		},
	};
}
