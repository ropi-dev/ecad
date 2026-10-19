import {
	ArrowDownToLine,
	Box,
	Check,
	ChevronLeft,
	ChevronRight,
	CircuitBoard,
	Folder,
	FolderOpen,
	Layers,
	Plus,
	Save,
	Search,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import {
	type AssetKind,
	PROJECT_FILE,
	type ProjectAsset,
} from "#/projects/format.ts";
import { ProjectLink, type ProjectPath } from "#/projects/ProjectLink.tsx";
import { useProject } from "#/projects/ProjectProvider.tsx";
import { SymbolLibraryControls } from "#/symbol-library/LibraryControls.tsx";

const focus =
	"focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#c7e991]";
const buttonBase = `inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-[5px] border px-3 py-[7px] text-[13px] transition-colors motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-40 ${focus}`;
const button = `${buttonBase} border-[#393d45] bg-[#212429] font-medium text-[#d3d6dc] hover:border-[#525861] hover:bg-[#2d3138] hover:text-white`;
const primaryButton = `${buttonBase} border-[#c7e991] bg-[#c7e991] font-semibold text-[#202a15] hover:border-[#d9f2b2] hover:bg-[#d9f2b2]`;
const sectionLabel =
	"mb-3.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[.12em] text-[#9297a1]";
const importButton = `relative inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded border border-[#353940] px-[9px] py-1.5 text-[11px] text-[#bfc4cd] transition-colors motion-reduce:transition-none hover:border-[#505761] hover:bg-[#282c32] focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-[#c7e991] has-[:disabled]:cursor-default has-[:disabled]:opacity-40`;
const tableHeading =
	"sticky top-0 z-10 border-y border-[#2b2e34] bg-[#202328] px-5 py-2.5 text-[10px] font-medium text-[#7f8793] max-[760px]:px-3";
const tableCell =
	"border-b border-[#282c31] py-2.5 align-middle group-last:border-b-0";
const fileColors: Record<string, string> = {
	Project: "border-[#3c4149] bg-[#24282e] text-[#9ba4b0]",
	Drawing: "border-[#46573a] bg-[#2b3424] text-[#c6e4a0]",
	Gerber: "border-[#35534c] bg-[#223430] text-[#90c8bc]",
	STEP: "border-[#3b4b69] bg-[#263044] text-[#a2b9e4]",
	Symbol: "border-[#50415f] bg-[#31273c] text-[#c3abd8]",
};

const filters = ["All files", "Drawing", "Gerber", "STEP", "Symbol"] as const;
type FileFilter = (typeof filters)[number];
const fileLabels: Record<string, string> = {
	Project: "PR",
	Drawing: "2D",
	Symbol: "SY",
	Gerber: "GB",
	STEP: "3D",
};
const fileDescriptions: Record<string, string> = {
	Project: "Project manifest",
	Drawing: "Project drawing",
	Symbol: "Symbol library",
	Gerber: "Source file",
	STEP: "Source file",
};
const pageSize = 50;

interface ProjectFile {
	path: string;
	name: string;
	type: string;
	href?: ProjectPath;
	asset?: ProjectAsset;
}

export function ProjectPage() {
	const project = useProject();
	const library = useSymbolLibrary();
	const [name, setName] = useState("");
	const [projects, setProjects] = useState<string[]>([]);
	const [pageError, setPageError] = useState("");
	const [importing, setImporting] = useState(false);
	const [filePage, setFilePage] = useState(0);
	const [librariesOpen, setLibrariesOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<FileFilter>("All files");
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
	const files = useMemo<ProjectFile[]>(
		() =>
			snapshot
				? [
						{ path: PROJECT_FILE, name: PROJECT_FILE, type: "Project" },
						{
							path: snapshot.manifest.drawing,
							name: "Drawing",
							type: "Drawing",
							href: "/editor",
						},
						...snapshot.manifest.symbols.map((path) => ({
							path,
							name: path.split("/").at(-1) ?? path,
							type: "Symbol",
							href: "/editor" as const,
						})),
						...snapshot.manifest.assets.map((asset) => ({
							path: asset.path,
							name: asset.name,
							type: asset.kind === "step" ? "STEP" : "Gerber",
							href: asset.kind === "step" ? ("/step" as const) : ("/" as const),
							asset,
						})),
					]
				: [],
		[snapshot],
	);
	const counts = useMemo(() => {
		const counts: Record<string, number> = { "All files": files.length };
		for (const file of files) counts[file.type] = (counts[file.type] ?? 0) + 1;
		return counts;
	}, [files]);
	const filteredFiles = useMemo(() => {
		const search = query.trim().toLowerCase();
		return files.filter(
			(file) =>
				(filter === "All files" || file.type === filter) &&
				(!search ||
					file.name.toLowerCase().includes(search) ||
					file.path.toLowerCase().includes(search)),
		);
	}, [files, filter, query]);
	const lastPage = Math.max(0, Math.ceil(filteredFiles.length / pageSize) - 1);
	const currentPage = Math.min(filePage, lastPage);
	const firstFile = currentPage * pageSize;
	const visibleFiles = filteredFiles.slice(firstFile, firstFile + pageSize);
	if (!project) return null;
	const busy = project.busy || importing;
	async function upload(files: File[], kind: AssetKind) {
		if (!project || !files.length) return;
		setImporting(true);
		setPageError("");
		try {
			await project.importAssets(files, kind);
		} catch (cause) {
			setPageError(
				cause instanceof Error ? cause.message : "Unable to add project files.",
			);
		} finally {
			setImporting(false);
		}
	}
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
				<nav
					aria-label="Workspaces"
					className="flex gap-2 max-[760px]:w-full max-[760px]:justify-between max-[760px]:gap-0.5"
				>
					<ProjectLink
						href="/editor"
						className={`flex items-center gap-2 rounded-[5px] px-3 py-[9px] text-[#a9aeb8] no-underline transition-colors motion-reduce:transition-none hover:bg-[#25282d] hover:text-white max-[760px]:px-2 max-[760px]:py-1.5 max-[760px]:text-[11px] ${focus}`}
					>
						<CircuitBoard
							className="size-4 shrink-0 stroke-[1.65]"
							aria-hidden="true"
						/>
						Schematic editor
					</ProjectLink>
					<ProjectLink
						href="/"
						className={`flex items-center gap-2 rounded-[5px] px-3 py-[9px] text-[#a9aeb8] no-underline transition-colors motion-reduce:transition-none hover:bg-[#25282d] hover:text-white max-[760px]:px-2 max-[760px]:py-1.5 max-[760px]:text-[11px] ${focus}`}
						onClick={() => project.selectAsset(null)}
					>
						<Layers
							className="size-4 shrink-0 stroke-[1.65]"
							aria-hidden="true"
						/>
						Gerber viewer
					</ProjectLink>
					<ProjectLink
						href="/step"
						className={`flex items-center gap-2 rounded-[5px] px-3 py-[9px] text-[#a9aeb8] no-underline transition-colors motion-reduce:transition-none hover:bg-[#25282d] hover:text-white max-[760px]:px-2 max-[760px]:py-1.5 max-[760px]:text-[11px] ${focus}`}
					>
						<Box className="size-4 shrink-0 stroke-[1.65]" aria-hidden="true" />
						STEP viewer
					</ProjectLink>
				</nav>
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
						<>
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
							<section
								className="overflow-hidden rounded-[7px] border border-[#2b2e34] bg-[#191b1f]"
								aria-labelledby="project-files-heading"
							>
								<div className="flex flex-wrap items-center justify-between gap-3.5 px-5 py-4 max-[760px]:px-3">
									<div className="flex items-center gap-[9px]">
										<h3
											id="project-files-heading"
											className="m-0 text-sm font-medium"
										>
											Project files
										</h3>
										<span className="rounded border border-[#383c42] px-1.5 py-px text-[10px] text-[#9299a3] tabular-nums">
											{files.length}
										</span>
									</div>
									<div className="flex items-center gap-1.5 max-[760px]:flex-wrap">
										<span className="mr-[5px] flex items-center gap-1.5 text-[11px] text-[#7d8590] max-[760px]:hidden">
											<ArrowDownToLine
												className="size-4 shrink-0 stroke-[1.65]"
												aria-hidden="true"
											/>
											Add files
										</span>
										<label className={importButton}>
											<Layers
												className="size-4 shrink-0 stroke-[1.65]"
												aria-hidden="true"
											/>
											Gerber
											<input
												type="file"
												className="absolute inset-0 size-full cursor-pointer opacity-0"
												multiple
												aria-label="Add Gerber files"
												disabled={busy}
												onChange={(event) => {
													void upload(
														Array.from(event.target.files ?? []),
														"gerber",
													);
													event.target.value = "";
												}}
											/>
										</label>
										<label className={importButton}>
											<Box
												className="size-4 shrink-0 stroke-[1.65]"
												aria-hidden="true"
											/>
											STEP
											<input
												type="file"
												className="absolute inset-0 size-full cursor-pointer opacity-0"
												multiple
												accept=".step,.stp"
												aria-label="Add STEP files"
												disabled={busy}
												onChange={(event) => {
													void upload(
														Array.from(event.target.files ?? []),
														"step",
													);
													event.target.value = "";
												}}
											/>
										</label>
										<label className={importButton}>
											<CircuitBoard
												className="size-4 shrink-0 stroke-[1.65]"
												aria-hidden="true"
											/>
											Symbols
											<input
												type="file"
												className="absolute inset-0 size-full cursor-pointer opacity-0"
												multiple
												accept=".ecadsym,.json"
												aria-label="Add symbol files"
												disabled={busy || library.loading}
												onChange={(event) => {
													void library.upload(
														Array.from(event.target.files ?? []),
													);
													event.target.value = "";
												}}
											/>
										</label>
									</div>
								</div>
								{importing && (
									<output
										className="block px-5 pb-3.5 text-xs text-[#c7e991]"
										aria-live="polite"
									>
										Adding project files...
									</output>
								)}
								<div className="flex items-center justify-between gap-3 px-5 pb-3 max-[1100px]:flex-wrap max-[760px]:px-3 max-[760px]:pb-3.5">
									<fieldset
										className="m-0 flex min-w-0 flex-wrap gap-[3px] border-0 p-0 max-[760px]:gap-px"
										aria-label="File types"
									>
										{filters.map((type) => (
											<button
												className={`rounded border border-transparent bg-transparent px-2 py-[5px] text-[11px] whitespace-nowrap text-[#939aa5] transition-colors motion-reduce:transition-none hover:bg-[#25292f] hover:text-[#d3d7dd] aria-pressed:border-[#414c35] aria-pressed:bg-[#293023] aria-pressed:text-[#c7e991] max-[760px]:px-1.5 ${focus}`}
												key={type}
												type="button"
												aria-pressed={filter === type}
												onClick={() => {
													setFilter(type);
													setFilePage(0);
												}}
											>
												{type === "Symbol" ? "Symbols" : type}
												<span className="ml-1.5 text-[9px] text-[#6e7580] tabular-nums">
													{counts[type] ?? 0}
												</span>
											</button>
										))}
									</fieldset>
									<div className="flex w-[180px] min-w-[130px] items-center gap-[7px] rounded border border-[#343940] bg-[#15171b] px-[9px] focus-within:border-[#c7e991] focus-within:ring-1 focus-within:ring-[#c7e991] max-[1100px]:w-full">
										<Search
											className="size-4 shrink-0 stroke-[1.65]"
											aria-hidden="true"
										/>
										<input
											type="search"
											className="h-8 w-full min-w-0 border-0 bg-transparent text-[11px] text-[#d7dbe2] outline-none placeholder:text-[#767d87] [&::-webkit-search-cancel-button]:hidden"
											aria-label="Search project files"
											placeholder="Find a file..."
											value={query}
											onChange={(event) => {
												setQuery(event.target.value);
												setFilePage(0);
											}}
										/>
										{query && (
											<button
												type="button"
												aria-label="Clear file search"
												className={`flex border-0 bg-transparent p-0 text-[#939aa5] ${focus}`}
												onClick={() => {
													setQuery("");
													setFilePage(0);
												}}
											>
												<X
													className="size-4 shrink-0 stroke-[1.65]"
													aria-hidden="true"
												/>
											</button>
										)}
									</div>
								</div>
								<div className="max-h-[max(260px,calc(100dvh-400px))] overflow-auto max-[1100px]:max-h-[max(260px,calc(100dvh-450px))] max-[760px]:max-h-none">
									<table className="w-full table-fixed border-collapse text-left">
										<caption className="sr-only">
											Files in the current project
										</caption>
										<thead>
											<tr>
												<th scope="col" className={`${tableHeading} w-[65%]`}>
													Name
												</th>
												<th
													scope="col"
													className={`${tableHeading} w-[15%] max-[760px]:hidden`}
												>
													Type
												</th>
												<th
													scope="col"
													className={`${tableHeading} w-1/5 max-[760px]:w-[35%]`}
												>
													<span className="sr-only">Action</span>
												</th>
											</tr>
										</thead>
										<tbody>
											{visibleFiles.map((file) => (
												<tr
													key={file.path}
													className="group hover:bg-[#202329]"
												>
													<td
														className={`${tableCell} relative pr-5 pl-[62px] max-[760px]:pr-3 max-[760px]:pl-[50px]`}
													>
														<span
															className={`absolute top-1/2 left-5 grid h-[34px] w-[30px] -translate-y-1/2 place-items-center rounded border font-mono text-[9px] font-semibold max-[760px]:left-3 ${fileColors[file.type]}`}
															data-kind={file.type}
															aria-hidden="true"
														>
															{fileLabels[file.type]}
														</span>
														<p className="m-0 truncate text-xs font-normal text-[#d9dce2]">
															{file.name}
														</p>
														<p
															className="mt-[3px] truncate font-mono text-[10px] leading-[normal] text-[#707986]"
															title={mode === "desktop" ? file.path : undefined}
														>
															{mode === "desktop"
																? file.path
																: fileDescriptions[file.type]}
														</p>
													</td>
													<td
														className={`${tableCell} px-5 font-mono text-[10px] text-[#8f98a5] max-[760px]:hidden`}
													>
														{file.type}
													</td>
													<td className={`${tableCell} px-5 max-[760px]:px-3`}>
														{file.href && (
															<ProjectLink
																href={file.href}
																aria-label={`Open ${file.name}`}
																className="focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#c7e991] flex items-center justify-end gap-2 py-1.5 text-[11px] text-[#8e97a4] no-underline transition-colors motion-reduce:transition-none after:ml-0.5 after:size-1.5 after:rotate-45 after:border-t after:border-r after:border-current after:content-[''] hover:text-[#c7e991]"
																onClick={() => {
																	if (file.asset)
																		project.selectAsset(file.asset);
																}}
															>
																Open
															</ProjectLink>
														)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
								{filteredFiles.length === 0 && (
									<div className="flex flex-col items-center px-5 py-[42px] text-center text-[#858f9b]">
										<Search
											className="mb-3 size-6 shrink-0 stroke-[1.65]"
											aria-hidden="true"
										/>
										<h4 className="m-0 text-sm text-[#d2d7df]">
											No matching files
										</h4>
										<p className="mt-1.5 mb-[18px] text-xs">
											Try another filename or file type.
										</p>
										<button
											type="button"
											className={button}
											onClick={() => {
												setQuery("");
												setFilter("All files");
												setFilePage(0);
											}}
										>
											Clear filters
										</button>
									</div>
								)}
								<footer className="flex min-h-12 items-center justify-between border-t border-[#2b2e34] px-5 py-2.5 text-[11px] text-[#7e8793] max-[760px]:px-3">
									<span aria-live="polite" className="tabular-nums">
										{filteredFiles.length
											? `${firstFile + 1}–${Math.min(firstFile + pageSize, filteredFiles.length)} of ${filteredFiles.length} files`
											: "0 files"}
									</span>
									{filteredFiles.length > pageSize && (
										<nav
											aria-label="Project file pages"
											className="flex items-center gap-3"
										>
											<button
												type="button"
												className="focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#c7e991] flex size-7 items-center justify-center rounded border border-[#3a414b] bg-transparent text-[#abb4c0] transition-colors motion-reduce:transition-none hover:enabled:bg-[#2b3037] disabled:opacity-40"
												aria-label="Previous files"
												disabled={currentPage === 0}
												onClick={() => setFilePage(currentPage - 1)}
											>
												<ChevronLeft
													className="size-4 shrink-0 stroke-[1.65]"
													aria-hidden="true"
												/>
											</button>
											<span>
												{currentPage + 1} / {lastPage + 1}
											</span>
											<button
												type="button"
												className="focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#c7e991] flex size-7 items-center justify-center rounded border border-[#3a414b] bg-transparent text-[#abb4c0] transition-colors motion-reduce:transition-none hover:enabled:bg-[#2b3037] disabled:opacity-40"
												aria-label="Next files"
												disabled={currentPage === lastPage}
												onClick={() => setFilePage(currentPage + 1)}
											>
												<ChevronRight
													className="size-4 shrink-0 stroke-[1.65]"
													aria-hidden="true"
												/>
											</button>
										</nav>
									)}
								</footer>
							</section>
						</>
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
