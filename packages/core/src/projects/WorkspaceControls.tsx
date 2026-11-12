import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";

interface EditorControls {
	id: symbol;
	store: ReturnType<typeof createDrawingStore>;
	enableMcp: boolean;
}

/** What the open workspace tells the sidebar about itself. */
export interface WorkspaceDocument {
	/** Project path of the open file, to mark its row in the sidebar. */
	path?: string;
	/** The file is open in its circuit view. A drawing and its circuit can share a path. */
	circuit: boolean;
	/** The workspace has no rulers, so its chrome sits closer to the edge. */
	plain: boolean;
}

export interface SidebarActions {
	open: () => void;
	openAddMenu: () => void;
	openSettings: () => void;
}

interface WorkspaceControlsValue {
	editor: EditorControls | null;
	registerEditor: (
		store: EditorControls["store"],
		enableMcp: boolean,
	) => () => void;
	document: WorkspaceDocument | null;
	sidebarPinned: boolean;
	sidebar: SidebarActions | null;
}

interface WorkspaceRegistration {
	registerEditor: WorkspaceControlsValue["registerEditor"];
	registerDocument: (document: WorkspaceDocument) => () => void;
	setSidebarPinned: (pinned: boolean) => void;
	registerSidebar: (actions: SidebarActions) => () => void;
}

const WorkspaceControls = createContext<WorkspaceControlsValue | null>(null);
const Registration = createContext<WorkspaceRegistration | null>(null);

/** Labelled tile in the sidebar's project actions row. A pressed tile carries the accent. */
export const workspaceActionClassName =
	"ui-toggle flex h-12 w-full min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border text-2xs font-medium no-underline [--toggle-bg:var(--color-hover)] [--toggle-line:var(--color-line-subtle)] [--toggle-on-line:var(--color-accent-line)] hover:[--toggle-bg:var(--color-pressed)] hover:[--toggle-line:var(--color-line)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-40 disabled:[--toggle-fg:var(--color-fg-muted)] data-[state=open]:[--toggle-bg:var(--color-pressed)] data-[state=open]:[--toggle-fg:var(--color-fg)] data-[state=open]:[--toggle-line:var(--color-line)]";

export function WorkspaceControlsProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [editors, setEditors] = useState<EditorControls[]>([]);
	const [documents, setDocuments] = useState<
		(WorkspaceDocument & { id: symbol })[]
	>([]);
	const [sidebarPinned, setSidebarPinned] = useState(false);
	const [sidebar, setSidebar] = useState<SidebarActions | null>(null);
	const registerSidebar = useCallback((actions: SidebarActions) => {
		setSidebar(actions);
		return () =>
			setSidebar((current) => (current === actions ? null : current));
	}, []);
	const registerEditor = useCallback(
		(store: EditorControls["store"], enableMcp: boolean) => {
			const id = Symbol();
			setEditors((current) => [...current, { id, store, enableMcp }]);
			return () =>
				setEditors((current) => current.filter((editor) => editor.id !== id));
		},
		[],
	);
	const registerDocument = useCallback((document: WorkspaceDocument) => {
		const id = Symbol();
		setDocuments((current) => [...current, { ...document, id }]);
		return () =>
			setDocuments((current) => current.filter((entry) => entry.id !== id));
	}, []);
	const registration = useMemo(
		() => ({
			registerEditor,
			registerDocument,
			setSidebarPinned,
			registerSidebar,
		}),
		[registerEditor, registerDocument, registerSidebar],
	);
	const value = useMemo(
		() => ({
			editor: editors.at(-1) ?? null,
			registerEditor,
			document: documents.at(-1) ?? null,
			sidebarPinned,
			sidebar,
		}),
		[editors, registerEditor, documents, sidebarPinned, sidebar],
	);
	return (
		<Registration.Provider value={registration}>
			<WorkspaceControls.Provider value={value}>
				{children}
			</WorkspaceControls.Provider>
		</Registration.Provider>
	);
}

export const useWorkspaceControls = () => useContext(WorkspaceControls);
export const useWorkspaceRegistration = () => useContext(Registration);
export const useEditorControlsRegistration = () =>
	useContext(Registration)?.registerEditor ?? null;
