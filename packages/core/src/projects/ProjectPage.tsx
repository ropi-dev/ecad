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

const button =
	"inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/20 px-3 text-sm text-white/90 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-50";
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
	const list = project?.list;
	const mode = project?.mode;
	useEffect(() => {
		if (mode !== "web" || !list) return;
		let cancelled = false;
		void list()
			.then((saved) => {
				if (!cancelled) setProjects(saved);
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
	}, [list, mode]);
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
	const lastPage = Math.max(0, Math.ceil(files.length / pageSize) - 1);
	const currentPage = Math.min(filePage, lastPage);
	const firstFile = currentPage * pageSize;
	const visibleFiles = files.slice(firstFile, firstFile + pageSize);
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
		<main className="min-h-dvh bg-slate-950 px-4 py-6 text-slate-100 sm:px-8">
			<div className="mx-auto max-w-6xl space-y-6">
				<header className="flex flex-wrap items-center justify-between gap-4">
					<h1 className="text-2xl font-medium">Projects</h1>
					<nav aria-label="Workspaces" className="flex flex-wrap gap-2">
						<ProjectLink href="/editor" className={button}>
							2D editor
						</ProjectLink>
						<ProjectLink
							href="/"
							className={button}
							onClick={() => project.selectAsset(null)}
						>
							Gerber viewer
						</ProjectLink>
						<ProjectLink href="/step" className={button}>
							STEP viewer
						</ProjectLink>
					</nav>
				</header>
				<details
					open={librariesOpen}
					onToggle={(event) => setLibrariesOpen(event.currentTarget.open)}
					className="rounded-xl border border-white/20 bg-slate-900 p-5"
				>
					<summary className="cursor-pointer text-sm font-medium">
						Symbol libraries
					</summary>
					{librariesOpen && (
						<div className="mt-4 max-w-md">
							<SymbolLibraryControls library={library} feedback={false} />
						</div>
					)}
				</details>
				{library.message && (
					<output className="block text-sm text-slate-300">
						{library.message}
					</output>
				)}
				{(project.error || pageError || library.error) && (
					<p
						role="alert"
						className="rounded-lg border border-red-300/30 bg-slate-900 p-4 text-red-300"
					>
						{project.error || pageError || library.error}
					</p>
				)}
				<section
					aria-label="Current project"
					className="rounded-xl border border-white/20 bg-slate-900 p-5"
				>
					{snapshot ? (
						<>
							<div className="flex flex-wrap items-start justify-between gap-4">
								<div>
									<h2 className="text-xl font-medium">
										{snapshot.manifest.name}
									</h2>
									<p className="mt-1 break-all text-sm text-slate-400">
										{snapshot.directory}
									</p>
								</div>
								<div className="flex items-center gap-3">
									<output
										aria-label="Project save status"
										className="text-sm text-slate-300"
									>
										{project.dirty ? "Unsaved" : "Saved"}
									</output>
									<button
										type="button"
										disabled={busy}
										className={button}
										onClick={() => void project.save().catch(() => undefined)}
									>
										Save project
									</button>
								</div>
							</div>
							{project.error && (
								<div className="mt-3 flex flex-wrap items-center gap-3">
									<button
										type="button"
										disabled={busy}
										className={button}
										onClick={() => void project.reload()}
									>
										Reload project
									</button>
									<p className="text-sm text-slate-400">
										Reloading discards unsaved drawing changes.
									</p>
								</div>
							)}
							<div className="mt-5 border-t border-white/20 pt-5">
								<h3 className="mb-3 text-lg font-medium">Project files</h3>
								<div className="mb-4 flex flex-wrap gap-2">
									<label
										className={`${button} relative cursor-pointer focus-within:outline-2 focus-within:outline-white`}
									>
										Add Gerber files
										<input
											type="file"
											multiple
											aria-label="Add Gerber files"
											disabled={busy}
											className="absolute inset-0 size-full cursor-pointer opacity-0"
											onChange={(event) => {
												void upload(
													Array.from(event.target.files ?? []),
													"gerber",
												);
												event.target.value = "";
											}}
										/>
									</label>
									<label
										className={`${button} relative cursor-pointer focus-within:outline-2 focus-within:outline-white`}
									>
										Add STEP files
										<input
											type="file"
											multiple
											accept=".step,.stp"
											aria-label="Add STEP files"
											disabled={busy}
											className="absolute inset-0 size-full cursor-pointer opacity-0"
											onChange={(event) => {
												void upload(
													Array.from(event.target.files ?? []),
													"step",
												);
												event.target.value = "";
											}}
										/>
									</label>
									<label
										className={`${button} relative cursor-pointer focus-within:outline-2 focus-within:outline-white`}
									>
										Add symbols
										<input
											type="file"
											multiple
											accept=".ecadsym,.json"
											aria-label="Add symbol files"
											disabled={busy || library.loading}
											className="absolute inset-0 size-full cursor-pointer opacity-0"
											onChange={(event) => {
												void library.upload(
													Array.from(event.target.files ?? []),
												);
												event.target.value = "";
											}}
										/>
									</label>
								</div>
								{importing && (
									<output className="mb-3 block text-sm text-slate-300">
										Adding project files...
									</output>
								)}
								<div className="overflow-x-auto">
									<table className="w-full text-left text-sm">
										<caption className="sr-only">
											Files in the current project
										</caption>
										<thead className="border-b border-white/20 text-slate-400">
											<tr>
												<th scope="col" className="py-3 pr-4 font-medium">
													File
												</th>
												<th scope="col" className="py-3 pr-4 font-medium">
													Type
												</th>
												<th scope="col" className="py-3 font-medium">
													Action
												</th>
											</tr>
										</thead>
										<tbody>
											{visibleFiles.map((file) => (
												<tr
													key={file.path}
													className="border-b border-white/10"
												>
													<td className="py-3 pr-4">
														<p>{file.name}</p>
														<p className="mt-1 break-all text-xs text-slate-400">
															{file.path}
														</p>
													</td>
													<td className="py-3 pr-4">{file.type}</td>
													<td className="py-3">
														{file.href && (
															<ProjectLink
																href={file.href}
																aria-label={`Open ${file.name}`}
																className={button}
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
								{files.length > pageSize && (
									<nav
										aria-label="Project file pages"
										className="mt-4 flex flex-wrap items-center gap-3"
									>
										<button
											type="button"
											className={button}
											disabled={currentPage === 0}
											onClick={() => setFilePage(currentPage - 1)}
										>
											Previous files
										</button>
										<output>
											{firstFile + 1}–
											{Math.min(firstFile + pageSize, files.length)} of{" "}
											{files.length} files
										</output>
										<button
											type="button"
											className={button}
											disabled={currentPage === lastPage}
											onClick={() => setFilePage(currentPage + 1)}
										>
											Next files
										</button>
									</nav>
								)}
							</div>
						</>
					) : (
						<>
							<h2 className="text-xl font-medium">No project open</h2>
							<p className="mt-2 text-sm text-slate-400">
								Create or open a project to manage its drawing, symbols, and
								source files.
							</p>
						</>
					)}
				</section>
				<div className="grid gap-6 md:grid-cols-2">
					<section
						aria-label="Create project"
						className="rounded-xl border border-white/20 bg-slate-900 p-5"
					>
						<h2 className="mb-4 text-lg font-medium">Create a project</h2>
						<form
							className="space-y-3"
							onSubmit={(event) => {
								event.preventDefault();
								void project.create(name);
							}}
						>
							<label htmlFor="project-name" className="block text-sm">
								Project name
							</label>
							<input
								id="project-name"
								required
								maxLength={120}
								value={name}
								disabled={busy}
								onChange={(event) => setName(event.target.value)}
								className="h-11 w-full rounded-lg border border-white/20 bg-slate-950 px-3 focus-visible:outline-2 focus-visible:outline-white"
							/>
							<button
								type="submit"
								disabled={busy || !name.trim()}
								className={button}
							>
								Create project
							</button>
						</form>
						<p className="mt-3 text-sm text-slate-400">
							{mode === "desktop"
								? "Choose a parent directory for the new project."
								: "Projects are saved in this browser on this device."}
						</p>
					</section>
					<section
						aria-label="Open project"
						className="rounded-xl border border-white/20 bg-slate-900 p-5"
					>
						<h2 className="mb-4 text-lg font-medium">Open a project</h2>
						{mode === "desktop" ? (
							<button
								type="button"
								disabled={busy}
								className={button}
								onClick={() => void project.open()}
							>
								Open project directory
							</button>
						) : (
							<div className="flex flex-col gap-2">
								{projects.length === 0 && (
									<p className="text-sm text-slate-400">
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
										className={`${button} justify-start`}
										onClick={() => void project.open(saved)}
									>
										{saved}
									</button>
								))}
							</div>
						)}
					</section>
				</div>
			</div>
		</main>
	);
}
