import { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import { SymbolLibraryControls } from "#/symbol-library/LibraryControls.tsx";

export function SymbolLibrarySettings() {
	const library = useSymbolLibrary();
	return <SymbolLibraryControls library={library} />;
}
