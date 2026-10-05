import { Editor2D } from "@ecad/core/components/editor/Editor2D.tsx";
import { GerberWorkspace } from "@ecad/core/components/gerber/GerberWorkspace.tsx";
import { StepWorkspace } from "@ecad/core/components/step/StepWorkspace.tsx";
import { SymbolLibraryProvider } from "@ecad/core/symbol-library/storage.tsx";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createDesktopSymbolLibraryStorage } from "#/renderer/storage.ts";
import "@ecad/core/styles.css";

type Workspace = "editor" | "gerber" | "step";
const storage = createDesktopSymbolLibraryStorage(window.ecadSymbolLibrary);

function App() {
	const [workspace, setWorkspace] = useState<Workspace>("editor");
	useEffect(() => {
		const navigate = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const href = target.closest("a")?.getAttribute("href");
			const next: Workspace | undefined =
				href === "/"
					? "gerber"
					: href === "/editor"
						? "editor"
						: href === "/step"
							? "step"
							: undefined;
			if (!next) return;
			event.preventDefault();
			setWorkspace(next);
		};
		document.addEventListener("click", navigate);
		return () => document.removeEventListener("click", navigate);
	}, []);
	return (
		<SymbolLibraryProvider storage={storage}>
			{workspace === "editor" ? (
				<Editor2D enableMcp={false} />
			) : workspace === "gerber" ? (
				<GerberWorkspace />
			) : (
				<StepWorkspace />
			)}
		</SymbolLibraryProvider>
	);
}

const root = document.getElementById("root");
if (!root) throw new Error("The desktop editor root element is missing.");
createRoot(root).render(<App />);
