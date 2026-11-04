import { formatShortcut } from "#/components/viewer/shortcutModifier.ts";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import "#/projects/WorkspaceStart.css";

export function WorkspaceStart() {
	const project = useProjectSelection(({ busy, error, reload }) => ({
		busy,
		error,
		reload,
	}));
	return (
		<main className="workspace-start relative flex h-full min-h-dvh flex-col font-sans text-slate-400">
			<div className="workspace-start-pointer">
				<svg
					role="img"
					aria-label="Hand-drawn arrow pointing to the sidebar"
					viewBox="0 0 150 80"
					className="workspace-start-arrow shrink-0 -rotate-6 text-slate-400"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.7"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M143 65 C116 69 106 39 83 30 S39 21 7 30 M8 30 Q21 20 28 13 M7 31 Q20 34 29 44" />
					<path d="M139 68 C115 70 105 43 84 33 S40 24 12 31" opacity=".35" />
				</svg>
				<p className="workspace-start-note">Start here</p>
			</div>
			<div className="workspace-start-message">
				{project?.busy ? (
					<output>Opening your workspace...</output>
				) : project?.error ? (
					<div role="alert">
						<p>{project.error}</p>
						<button
							type="button"
							className="underline focus-visible:outline-2"
							onClick={() => void project.reload()}
						>
							Try again
						</button>
					</div>
				) : (
					<dl
						className="workspace-start-instructions"
						aria-label="Workspace instructions"
					>
						<div>
							<dt>Create a file</dt>
							<dd>+</dd>
						</div>
						<div>
							<dt>Open a file</dt>
							<dd>Sidebar</dd>
						</div>
						<div>
							<dt>Pin or compact sidebar</dt>
							<dd>{formatShortcut("Ctrl+Shift+S")}</dd>
						</div>
						<div>
							<dt>View a board</dt>
							<dd>Import Gerber or STEP</dd>
						</div>
					</dl>
				)}
			</div>
		</main>
	);
}
