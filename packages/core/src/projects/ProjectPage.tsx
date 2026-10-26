import {
	Check,
	CircuitBoard,
	Folder,
	FolderOpen,
	Plus,
	Save,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import { useProject } from "#/projects/ProjectProvider.tsx";
import { SymbolLibraryControls } from "#/symbol-library/LibraryControls.tsx";

const focus =
	"focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#c7e991]";
const buttonBase = `inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-[5px] border px-3 py-[7px] text-[13px] transition-colors motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-40 ${focus}`;
const button = `${buttonBase} border-[#393d45] bg-[#212429] font-medium text-[#d3d6dc] hover:border-[#525861] hover:bg-[#2d3138] hover:text-white`;
const primaryButton = `${buttonBase} border-[#c7e991] bg-[#c7e991] font-semibold text-[#202a15] hover:border-[#d9f2b2] hover:bg-[#d9f2b2]`;
const sectionLabel =
	"mb-3.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[.12em] text-[#9297a1]";
export function ProjectPage() {
	const project = useProject();
	const library = useSymbolLibrary();
	const [name, setName] = useState("");
	const [projects, setProjects] = useState<string[]>([]);
	const [pageError, setPageError] = useState("");
	const [librariesOpen, setLibrariesOpen] = useState(false);
	const list = project?.list;
	const mode = project?.mode;
	const directory = project?.project?.directory;
	useEffect(() => {
		if (mode !== "web" || !list) return;
		let cancelled = false;
		void list()
			.then((saved) => {
				if (!cancelled)
					setProjects(
						directory && !saved.includes(directory)
							? [...saved, directory]
							: saved,
					);
			})
			.catch((cause: unknown) => {
				if (!cancelled)
					setPageError(
						cause instanceof Error ? cause.message : "Unable to list projects.",
					);
			});
		return () => {
			cancelled = true;
		};
	}, [list, mode, directory]);
	const snapshot = project?.project;
	if (!project) return null;
	const busy = project.busy;
	return (
		<main className="min-h-dvh bg-[#131518] text-[13px] leading-normal text-[#e8e9ec]">
			<header className="flex min-h-16 items-center justify-between gap-6 border-b border-[#2b2e34] bg-[#17191c] px-7 max-[760px]:flex-wrap max-[760px]:gap-3 max-[760px]:px-[18px] max-[760px]:py-3.5">
				<div className="flex items-center gap-3 text-[15px] font-semibold tracking-[.035em]">
					<CircuitBoard
						className="size-[23px] shrink-0 stroke-[1.65] text-[#c7e991]"
						aria-hidden="true"
					/>
					<span>ECAD</span>
					<span className="ml-3 mr-[5px] h-5 w-px bg-[#383b42]" />
					<h1 className="m-0 text-[13px] font-normal tracking-normal text-[#b6bac2]">
						Projects
					</h1>
				</div>
			</header>
			<div className="grid min-h-[calc(100dvh-64px)] grid-cols-[252px_minmax(0,1fr)] max-[1100px]:grid-cols-[220px_minmax(0,1fr)] max-[760px]:grid-cols-1">
				<aside
					className="flex flex-col gap-[30px] border-r border-[#2b2e34] bg-[#17191c] px-[18px] pb-5 pt-[30px] max-[760px]:grid max-[760px]:grid-cols-2 max-[760px]:gap-5 max-[760px]:border-r-0 max-[760px]:border-b max-[760px]:py-[22px]"
					aria-label="Project navigation"
				>
					<section aria-label="Open project" className="min-w-0">
						<div className={sectionLabel}>
							<span>
								{mode === "desktop" ? "Project folder" : "Your projects"}
							</span>
							<Folder
								className="size-4 shrink-0 stroke-[1.65]"
								aria-hidden="true"
							/>
						</div>
						{mode === "desktop" ? (
							<>
								{snapshot && (
									<div className="flex min-w-0 items-center gap-2.5 rounded-[5px] border border-[#374230] bg-[#252b23] p-2.5 text-[#c7e991]">
										<FolderOpen
											className="size-4 shrink-0 stroke-[1.65]"
											aria-hidden="true"
										/>
										<span className="truncate">{snapshot.manifest.name}</span>
										<span className="ml-auto size-[5px] shrink-0 rounded-full bg-[#c7e991]" />
									</div>
								)}
								<button
									type="button"
									disabled={busy}
									className={`${button} mt-3 w-full text-xs`}
									aria-label="Open project directory"
									onClick={() => void project.open()}
								>
									<FolderOpen
										className="size-4 shrink-0 stroke-[1.65]"
										aria-hidden="true"
									/>
									Open folder
								</button>
							</>
						) : (
							<div className="flex max-h-[280px] flex-col gap-1 overflow-y-auto max-[760px]:max-h-[178px]">
								{projects.length === 0 && (
									<p className="m-0 py-2 text-xs text-[#737984]">
										No saved projects yet.
									</p>
								)}
								{projects.map((saved) => (
									<button
										key={saved}
										type="button"
										disabled={busy}
										aria-current={
											snapshot?.directory === saved ? "true" : undefined
										}
										className={`flex min-w-0 items-center gap-2.5 rounded-[5px] border border-transparent bg-transparent p-2.5 text-left text-[#b3b7c0] transition-colors motion-reduce:transition-none hover:bg-[#22252a] hover:text-white aria-[current=true]:border-[#374230] aria-[current=true]:bg-[#252b23] aria-[current=true]:text-[#c7e991] disabled:opacity-40 ${focus}`}
										onClick={() => void project.open(saved)}
									>
										<Folder
											className="size-4 shrink-0 stroke-[1.65]"
											aria-hidden="true"
										/>
										<span className="truncate">{saved}</span>
										{snapshot?.directory === saved && (
											<span className="ml-auto size-[5px] shrink-0 rounded-full bg-[#c7e991]" />
										)}
									</button>
								))}
							</div>
						)}
					</section>
					<section
						aria-label="Create project"
						className="border-t border-[#2b2e34] pt-6 max-[760px]:min-w-0 max-[760px]:border-t-0 max-[760px]:pt-0"
					>
						<h2 className={sectionLabel}>New project</h2>
						<form
							className="flex flex-col gap-[9px]"
							onSubmit={(event) => {
								event.preventDefault();
								void project.create(name);
							}}
						>
							<label htmlFor="project-name" className="text-xs text-[#b4b8c1]">
								Project name
							</label>
							<input
								id="project-name"
								className={`min-h-[38px] w-full min-w-0 rounded-[5px] border border-[#353940] bg-[#121417] px-2.5 py-2 text-[#e8e9ec] placeholder:text-xs placeholder:text-[#626974] ${focus}`}
								required
								maxLength={120}
								value={name}
								disabled={busy}
								placeholder="e.g. Motor controller"
								onChange={(event) => setName(event.target.value)}
							/>
							<button
								type="submit"
								disabled={busy || !name.trim()}
								className={primaryButton}
							>
								<Plus
									className="size-4 shrink-0 stroke-[1.65]"
									aria-hidden="true"
								/>
								Create project
							</button>
						</form>
						<p className="mt-2.5 text-[11px] leading-[1.65] text-[#777e89]">
							{mode === "desktop"
								? "Choose where to save your project folder."
								: "Saved locally in this browser."}
						</p>
					</section>
					<div className="mt-auto flex items-center gap-2 px-[5px] pt-[15px] text-[11px] text-[#747b85] max-[760px]:hidden">
						<span className="size-[5px] shrink-0 rounded-full bg-[#818e73]" />
						<span>
							{mode === "desktop" ? "Files on your computer" : "On this device"}
						</span>
					</div>
				</aside>
				<section
					aria-label="Current project"
					className="w-full min-w-0 max-w-[1440px] px-[42px] pb-7 pt-8 min-[1700px]:px-16 max-[1100px]:px-6 max-[1100px]:py-[30px] max-[760px]:px-[18px] max-[760px]:py-[26px]"
				>
					{(project.error || pageError || library.error) && (
						<div
							role="alert"
							className="mb-6 rounded-[5px] border border-[#70443c] bg-[#302421] px-4 py-3.5 text-[#f0b8aa]"
						>
							<p className="m-0">
								{project.error || pageError || library.error}
							</p>
							{project.error && (
								<div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
									<button
										type="button"
										disabled={busy}
										className={button}
										onClick={() => void project.reload()}
									>
										Reload project
									</button>
									<span>Reloading discards unsaved drawing changes.</span>
								</div>
							)}
						</div>
					)}
					<details
						open={librariesOpen}
						onToggle={(event) => setLibrariesOpen(event.currentTarget.open)}
						className="mb-6 rounded-[7px] border border-[#2b2e34] bg-[#191b1f] p-5"
					>
						<summary className={`cursor-pointer text-sm font-medium ${focus}`}>
							Symbol libraries
						</summary>
						{librariesOpen && (
							<div className="mt-4 max-w-md">
								<SymbolLibraryControls library={library} feedback={false} />
							</div>
						)}
					</details>
					{library.message && (
						<output
							className="mb-3 block text-sm text-[#d3d6dc]"
							aria-live="polite"
						>
							{library.message}
						</output>
					)}
					{snapshot ? (
						<header className="mb-7 flex items-start justify-between gap-6 max-[760px]:mb-[26px] max-[760px]:flex-col max-[760px]:gap-4">
							<div className="min-w-0">
								<p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[.12em] text-[#9297a1]">
									Active project
								</p>
								<h2 className="m-0 text-[29px] leading-tight font-semibold tracking-[-.04em] wrap-anywhere max-[760px]:text-[26px]">
									{snapshot.manifest.name}
								</h2>
								<p
									className="mt-3 flex items-center gap-[7px] text-[11px] text-[#7d8590]"
									title={snapshot.directory}
								>
									<FolderOpen
										className="size-4 shrink-0 stroke-[1.65]"
										aria-hidden="true"
									/>
									<span className="truncate">{snapshot.directory}</span>
								</p>
							</div>
							<div className="flex shrink-0 items-center gap-[18px] pt-7 max-[760px]:flex-row-reverse max-[760px]:gap-3.5 max-[760px]:pt-0">
								<output
									aria-label="Project save status"
									className={`flex items-center gap-1.5 text-[11px] ${project.dirty ? "text-[#e2bd76]" : "text-[#b3c69b]"}`}
								>
									<Check
										className="size-4 shrink-0 stroke-[1.65]"
										aria-hidden="true"
									/>
									{project.dirty ? "Unsaved" : "Saved"}
								</output>
								<button
									type="button"
									disabled={busy}
									className={button}
									onClick={() => void project.save().catch(() => undefined)}
								>
									<Save
										className="size-4 shrink-0 stroke-[1.65]"
										aria-hidden="true"
									/>
									Save project
								</button>
							</div>
						</header>
					) : (
						<div className="flex min-h-[calc(100dvh-180px)] flex-col items-center justify-center px-3 py-10 text-center max-[760px]:min-h-[460px] max-[760px]:pt-[22px]">
							<div
								className="relative mb-[30px] grid h-[150px] w-[260px] place-items-center bg-[radial-gradient(#363d35_1px,transparent_1px)] bg-size-[16px_16px] mask-[radial-gradient(ellipse,black_45%,transparent_75%)]"
								aria-hidden="true"
							>
								<div className="relative grid h-[84px] w-[104px] place-items-center rounded-[10px] border border-[#46533b] bg-[#1e231c] text-[#b8d98b]">
									<FolderOpen className="size-[52px] shrink-0 stroke-1" />
									<CircuitBoard className="absolute right-3 bottom-[9px] size-[26px] bg-[#1e231c] p-1" />
								</div>
								<span className="absolute top-1/2 left-[26px] h-px w-[50px] bg-[#526441] after:absolute after:top-[-2px] after:left-0 after:size-[5px] after:rounded-full after:border after:border-[#657950] after:content-['']" />
								<span className="absolute top-1/2 right-[26px] h-px w-[50px] bg-[#526441] after:absolute after:top-[-2px] after:right-0 after:size-[5px] after:rounded-full after:border after:border-[#657950] after:content-['']" />
							</div>
							<p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[.12em] text-[#9297a1]">
								Your workspace
							</p>
							<h2 className="m-0 mb-3.5 text-[29px] font-medium tracking-[-.035em]">
								No project open
							</h2>
							<p className="m-0 mb-[26px] text-[13px] leading-[1.8] text-[#8b929e]">
								Keep your drawing, symbols, and source files together.
								<br />
								Create a project or open an existing one to get started.
							</p>
							<button
								type="button"
								disabled={busy}
								className={primaryButton}
								onClick={() => document.getElementById("project-name")?.focus()}
							>
								<Plus
									className="size-4 shrink-0 stroke-[1.65]"
									aria-hidden="true"
								/>
								Start a new project
							</button>
							<div className="mt-11 flex gap-[22px] text-[11px] text-[#707a88] max-[760px]:gap-3.5 max-[760px]:text-[10px]">
								<span>2D drawings</span>
								<span>Gerber files</span>
								<span>STEP models</span>
							</div>
						</div>
					)}
				</section>
			</div>
		</main>
	);
}
