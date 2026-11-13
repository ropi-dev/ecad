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
	sidebarDocked: boolean;
	sidebar: SidebarActions | null;
}

interface WorkspaceRegistration {
	registerEditor: WorkspaceControlsValue["registerEditor"];
	registerDocument: (document: WorkspaceDocument) => () => void;
	setSidebarDocked: (docked: boolean) => void;
	registerSidebar: (actions: SidebarActions) => () => void;
}

const WorkspaceControls = createContext<WorkspaceControlsValue | null>(null);
const Registration = createContext<WorkspaceRegistration | null>(null);

export function WorkspaceControlsProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [editors, setEditors] = useState<EditorControls[]>([]);
	const [documents, setDocuments] = useState<
		(WorkspaceDocument & { id: symbol })[]
	>([]);
	const [sidebarDocked, setSidebarDocked] = useState(false);
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
			setSidebarDocked,
			registerSidebar,
		}),
		[registerEditor, registerDocument, registerSidebar],
	);
	const value = useMemo(
		() => ({
			editor: editors.at(-1) ?? null,
			registerEditor,
			document: documents.at(-1) ?? null,
			sidebarDocked,
			sidebar,
		}),
		[editors, registerEditor, documents, sidebarDocked, sidebar],
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
