import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useState,
} from "react";

interface EditorControls {
	id: symbol;
	store: ReturnType<typeof createDrawingStore>;
	enableMcp: boolean;
}

interface WorkspaceControlsValue {
	editor: EditorControls | null;
	registerEditor: (
		store: EditorControls["store"],
		enableMcp: boolean,
	) => () => void;
}

const WorkspaceControls = createContext<WorkspaceControlsValue | null>(null);
const EditorControlsRegistration = createContext<
	WorkspaceControlsValue["registerEditor"] | null
>(null);

export const workspaceActionClassName =
	"grid h-12 w-full cursor-pointer place-items-center rounded-xl bg-white/5 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#e8b77e] disabled:cursor-default disabled:opacity-40";

export function WorkspaceControlsProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [editors, setEditors] = useState<EditorControls[]>([]);
	const registerEditor = useCallback(
		(store: EditorControls["store"], enableMcp: boolean) => {
			const id = Symbol();
			setEditors((current) => [...current, { id, store, enableMcp }]);
			return () =>
				setEditors((current) => current.filter((editor) => editor.id !== id));
		},
		[],
	);
	return (
		<EditorControlsRegistration.Provider value={registerEditor}>
			<WorkspaceControls.Provider
				value={{ editor: editors.at(-1) ?? null, registerEditor }}
			>
				{children}
			</WorkspaceControls.Provider>
		</EditorControlsRegistration.Provider>
	);
}

export const useWorkspaceControls = () => useContext(WorkspaceControls);
export const useEditorControlsRegistration = () =>
	useContext(EditorControlsRegistration);
