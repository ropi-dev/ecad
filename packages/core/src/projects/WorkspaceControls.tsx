import type { JSX } from "@solidjs/web";
import { createContext, createSignal, useContext } from "solid-js";

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
	document: WorkspaceDocument | null;
	sidebarDocked: boolean;
	sidebar: SidebarActions | null;
}

interface WorkspaceRegistration {
	registerDocument: (document: WorkspaceDocument) => () => void;
	setSidebarDocked: (docked: boolean) => void;
	registerSidebar: (actions: SidebarActions) => () => void;
}

const WorkspaceControls = createContext<WorkspaceControlsValue | null>(null);
const Registration = createContext<WorkspaceRegistration | null>(null);

const owned = { ownedWrite: true };

export function WorkspaceControlsProvider(props: { children: JSX.Element }) {
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
	const registerDocument = (document: WorkspaceDocument) => {
		const id = Symbol();
		setDocuments((current) => [...current, { ...document, id }]);
		return () =>
			setDocuments((current) => current.filter((entry) => entry.id !== id));
	};
	const registration: WorkspaceRegistration = {
		registerDocument,
		setSidebarDocked: (docked) => setSidebarDocked(docked),
		registerSidebar,
	};
	const value: WorkspaceControlsValue = {
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
