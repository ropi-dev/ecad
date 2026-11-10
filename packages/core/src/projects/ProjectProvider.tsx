import {
	type ComponentType,
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import type { ProjectLinkProps } from "#/projects/ProjectLink.tsx";
import {
	createProjectSession,
	type ProjectContextValue,
	type ProjectSession,
} from "#/projects/ProjectSession.ts";
import type { ProjectStorage } from "#/projects/storage.ts";
import { WorkspaceControlsProvider } from "#/projects/WorkspaceControls.tsx";
import {
	SymbolLibraryProvider,
	type SymbolLibraryStorage,
} from "#/symbol-library/storage.tsx";

export type {
	CircuitDocument,
	DrawingDocument,
	SymbolDocument,
} from "#/projects/ProjectSession.ts";

const ProjectContext = createContext<ProjectSession | null>(null);

export function useProjectSelection<T>(
	select: (value: ProjectContextValue) => T,
): T | null {
	const session = useContext(ProjectContext);
	const previous = useRef<{ value: T } | null>(null);
	const getSnapshot = () => {
		if (!session) return null;
		const value = select(session.getSnapshot());
		const old = previous.current;
		if (
			old &&
			(Object.is(old.value, value) ||
				(typeof value === "object" &&
					value !== null &&
					typeof old.value === "object" &&
					old.value !== null &&
					Object.keys(value).length === Object.keys(old.value).length &&
					Object.entries(value).every(([key, entry]) =>
						Object.is(entry, (old.value as Record<string, unknown>)[key]),
					)))
		)
			return old.value;
		previous.current = { value };
		return value;
	};
	return useSyncExternalStore(
		session?.subscribe ?? emptySubscribe,
		getSnapshot,
		getSnapshot,
	);
}
const emptySubscribe = () => () => {};
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
			session,
			store,
			editorSymbol,
			editorDrawing,
			editorCircuit,
			selectedAsset,
		}) => ({
			session,
			store,
			editorSymbol,
			editorDrawing,
			editorCircuit,
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
			editorDrawing: _editorDrawing,
			editorCircuit: _editorCircuit,
			selectedAsset: _selectedAsset,
			...actions
		}) => actions,
	);

export function ProjectProvider({
	storage,
	symbolStorage,
	LinkComponent,
	wrapChildren = true,
	children,
}: {
	storage: ProjectStorage;
	symbolStorage: SymbolLibraryStorage;
	LinkComponent?: ComponentType<ProjectLinkProps>;
	wrapChildren?: boolean;
	children: ReactNode;
}) {
	const session = useMemo(
		() => createProjectSession(storage, symbolStorage, LinkComponent),
		[storage, symbolStorage, LinkComponent],
	);
	useEffect(() => session.connect(), [session]);
	return (
		<ProjectContext.Provider value={session}>
			<ProjectContents
				session={session}
				symbolStorage={symbolStorage}
				wrapChildren={wrapChildren}
			>
				{children}
			</ProjectContents>
		</ProjectContext.Provider>
	);
}
function ProjectContents({
	session,
	symbolStorage,
	wrapChildren,
	children,
}: {
	session: ProjectSession;
	symbolStorage: SymbolLibraryStorage;
	wrapChildren: boolean;
	children: ReactNode;
}) {
	const state = useProjectSelection(({ session, busy, project }) => ({
		session,
		busy,
		hasProject: project !== null,
	}));
	const projectSymbols = useMemo(
		() =>
			state?.hasProject ? session.getProjectSymbols(state.session) : undefined,
		[session, state?.session, state?.hasProject],
	);
	return (
		<SymbolLibraryProvider
			storage={symbolStorage}
			projectStorage={projectSymbols}
		>
			<WorkspaceControlsProvider>
				{wrapChildren ? (
					<div
						key={state?.session}
						aria-busy={state?.busy}
						inert={state?.busy}
						className={state?.busy ? "pointer-events-none" : undefined}
					>
						{children}
					</div>
				) : (
					children
				)}
			</WorkspaceControlsProvider>
		</SymbolLibraryProvider>
	);
}
