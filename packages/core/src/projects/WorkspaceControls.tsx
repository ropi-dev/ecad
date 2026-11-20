import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { JSX } from "@solidjs/web";
import { createContext, createSignal, useContext } from "solid-js";

interface EditorControls {
	id: symbol;
	store: ReturnType<typeof createDrawingStore>;
	enableMcp: boolean;
}

/** What the open workspace tells the sidebar about itself. */
export interface WorkspaceDocument {
	/** Project path of the open file, to mark its row in the sidebar. */
	path?: string;
	/** The view the file is open in. A drawing, its circuit and its PCB share a path. */
	view?: "circuit" | "pcb";
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

const owned = { ownedWrite: true };

export function WorkspaceControlsProvider(props: { children: JSX.Element }) {
	const [editors, setEditors] = createSignal<EditorControls[]>([], owned);
	const [documents, setDocuments] = createSignal<
		(WorkspaceDocument & { id: symbol })[]
	>([], owned);
	const [sidebarDocked, setSidebarDocked] = createSignal(false, owned);
	const [sidebar, setSidebar] = createSignal<SidebarActions | null>(
		null,
		owned,
	);
	const registerSidebar = (actions: SidebarActions) => {
		setSidebar(() => actions);
		return () =>
			setSidebar((current) => (current === actions ? null : current));
	};
	const registerEditor = (
		store: EditorControls["store"],
		enableMcp: boolean,
	) => {
		const id = Symbol();
		setEditors((current) => [...current, { id, store, enableMcp }]);
		return () =>
			setEditors((current) => current.filter((editor) => editor.id !== id));
	};
	const registerDocument = (document: WorkspaceDocument) => {
		const id = Symbol();
		setDocuments((current) => [...current, { ...document, id }]);
		return () =>
			setDocuments((current) => current.filter((entry) => entry.id !== id));
	};
	const registration: WorkspaceRegistration = {
		registerEditor,
		registerDocument,
		setSidebarDocked: (docked) => setSidebarDocked(docked),
		registerSidebar,
	};
	const value: WorkspaceControlsValue = {
		get editor() {
			return editors().at(-1) ?? null;
		},
		registerEditor,
		get document() {
			return documents().at(-1) ?? null;
		},
		get sidebarDocked() {
			return sidebarDocked();
		},
		get sidebar() {
			return sidebar();
		},
	};
	return (
		<Registration value={registration}>
			<WorkspaceControls value={value}>{props.children}</WorkspaceControls>
		</Registration>
	);
}

export const useWorkspaceControls = () => useContext(WorkspaceControls);
export const useWorkspaceRegistration = () => useContext(Registration);
export const useEditorControlsRegistration = () =>
	useContext(Registration)?.registerEditor ?? null;
