import type { JSX } from "@solidjs/web";
import {
	type Accessor,
	type Component,
	createContext,
	createMemo,
	onSettled,
	Show,
	untrack,
	useContext,
} from "solid-js";
import { Keyed } from "#/components/ui/Keyed.tsx";
import { fromExternalStore, shallowEqual } from "#/lib/external-store.ts";
import type { ProjectLinkProps } from "#/projects/ProjectLink.tsx";
import {
	createProjectSession,
	type ProjectContextValue,
	type ProjectSession,
} from "#/projects/ProjectSession.ts";
import type { ProjectStorage } from "#/projects/storage.ts";
import { WorkspaceControlsProvider } from "#/projects/WorkspaceControls.tsx";
import { SymbolLibraryProvider } from "#/symbol-library/SymbolLibraryProvider.tsx";
import type { SymbolLibraryStorage } from "#/symbol-library/storage.ts";

export type {
	BoardDocument,
	CircuitDocument,
	DrawingDocument,
	EditorView,
	EditorViews,
	SymbolDocument,
	SyncedViewSelection,
} from "#/projects/ProjectSession.ts";

interface ProjectContextState {
	session: ProjectSession;
	snapshot: Accessor<ProjectContextValue>;
}

const ProjectContext = createContext<ProjectContextState | null>(null);

export function useProjectSelection<T>(
	select: (value: ProjectContextValue) => T,
): Accessor<T | null> {
	const context = useContext(ProjectContext);
	if (!context) return () => null;
	return createMemo(() => select(context.snapshot()), {
		equals: shallowEqual,
	});
}

/** Reads the project as it is now, for code that runs after an await. */
export function useLatestProjectSnapshot() {
	const context = useContext(ProjectContext);
	return () => context?.session.getSnapshot().project ?? null;
}
export const useProject = () => useProjectSelection((value) => value);
export const useProjectSnapshot = () =>
	useProjectSelection((value) => value.project);
export const useProjectStatus = () =>
	useProjectSelection(
		({ busy, dirty, error, conflict, libraryErrors, otherUnsavedEdits }) => ({
			busy,
			dirty,
			error,
			conflict,
			libraryErrors,
			otherUnsavedEdits,
		}),
	);
export const useProjectEditor = () =>
	useProjectSelection(
		({
			project,
			session,
			store,
			editorSymbol,
			editorFootprint,
			editorBoard,
			editorDrawing,
			editorCircuit,
			editorViews,
			splitViews,
			openingCircuit,
			selectedAsset,
		}) => ({
			mainDrawing: project?.manifest.drawing !== undefined,
			session,
			store,
			editorSymbol,
			editorFootprint,
			editorBoard,
			editorDrawing,
			editorCircuit,
			editorViews,
			splitViews,
			openingCircuit,
			selectedAsset,
		}),
	);
export const useProjectActions = () =>
	useProjectSelection(
		({
			session: _session,
			project: _project,
			busy: _busy,
			dirty: _dirty,
			error: _error,
			conflict: _conflict,
			libraryErrors: _libraryErrors,
			otherUnsavedEdits: _otherUnsavedEdits,
			store: _store,
			editorSymbol: _editorSymbol,
			editorFootprint: _editorFootprint,
			editorBoard: _editorBoard,
			editorDrawing: _editorDrawing,
			editorCircuit: _editorCircuit,
			editorViews: _editorViews,
			splitViews: _splitViews,
			openingCircuit: _openingCircuit,
			selectedAsset: _selectedAsset,
			...actions
		}) => actions,
	);

export function ProjectProvider(props: {
	storage: ProjectStorage;
	symbolStorage: SymbolLibraryStorage;
	LinkComponent?: Component<ProjectLinkProps>;
	wrapChildren?: boolean;
	children: JSX.Element;
}) {
	const session = untrack(() =>
		createProjectSession(
			props.storage,
			props.symbolStorage,
			props.LinkComponent,
		),
	);
	const snapshot = fromExternalStore(
		(listener) => session.subscribe(listener),
		() => session.getSnapshot(),
	);
	onSettled(() => session.connect());
	return (
		<ProjectContext value={{ session, snapshot }}>
			<ProjectContents
				session={session}
				symbolStorage={props.symbolStorage}
				wrapChildren={props.wrapChildren ?? true}
			>
				{props.children}
			</ProjectContents>
		</ProjectContext>
	);
}

function ProjectContents(props: {
	session: ProjectSession;
	symbolStorage: SymbolLibraryStorage;
	wrapChildren: boolean;
	children: JSX.Element;
}) {
	const state = useProjectSelection(({ session, busy, project }) => ({
		session,
		busy,
		hasProject: project !== null,
	}));
	const symbolsSession = createMemo(() => {
		const current = state();
		return current?.hasProject ? current.session : undefined;
	});
	const projectSymbols = createMemo(() => {
		const session = symbolsSession();
		return session === undefined
			? undefined
			: props.session.getProjectSymbols(session);
	});
	return (
		<SymbolLibraryProvider
			storage={props.symbolStorage}
			projectStorage={projectSymbols()}
		>
			<WorkspaceControlsProvider>
				<Show when={props.wrapChildren} fallback={props.children}>
					<Keyed key={state()?.session}>
						<div
							aria-busy={state()?.busy ? "true" : "false"}
							inert={state()?.busy}
							class={{ "pointer-events-none": state()?.busy }}
						>
							{props.children}
						</div>
					</Keyed>
				</Show>
			</WorkspaceControlsProvider>
		</SymbolLibraryProvider>
	);
}
