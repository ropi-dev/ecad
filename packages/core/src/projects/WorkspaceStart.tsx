import { useProject } from "#/projects/ProjectProvider.tsx";

const fontCss = `
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/ibmplexsans/v23/zYXGKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1swZSAXcomDVmadSD6llzAA.ttf) format('truetype');
}
.workspace-start, .workspace-start * { font-family: 'IBM Plex Sans', sans-serif !important; }
`;

export function WorkspaceStart() {
	const project = useProject();
	return (
		<main
			className="workspace-start relative flex h-full min-h-dvh flex-col font-sans text-slate-400"
			style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
		>
			<style>{fontCss}</style>
			<div className="absolute left-5 top-8 flex items-center gap-3 sm:left-8">
				<svg
					role="img"
					aria-label="Hand-drawn arrow pointing to the sidebar"
					viewBox="0 0 150 80"
					className="h-20 w-28 shrink-0 -rotate-6 text-slate-500"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.7"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M143 65 C116 69 106 39 83 30 S39 21 7 30 M8 30 Q21 20 28 13 M7 31 Q20 34 29 44" />
					<path d="M139 68 C115 70 105 43 84 33 S40 24 12 31" opacity=".35" />
				</svg>
				<p className="max-w-44 text-xs leading-6">
					Start in the sidebar.
					<br />
					Use + to create a file.
				</p>
			</div>
			<div className="m-auto max-w-sm px-8 py-44 text-sm leading-8">
				{project?.busy ? (
					<p role="status">Opening your workspace...</p>
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
					<>
						<h1 className="mb-4 text-base font-normal text-slate-300">
							Ready when you are
						</h1>
						<p>Create a drawing, circuit, or symbol with +.</p>
						<p>Open a file from the sidebar to edit it.</p>
						<p>Import Gerber or STEP files to view a board.</p>
						<p className="mt-4 text-xs text-slate-500">
							{project?.project?.inMemory
								? "Kept in memory. Choose Save project to keep your work."
								: "Your changes save automatically."}
						</p>
					</>
				)}
			</div>
		</main>
	);
}
