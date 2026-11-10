import { FolderOpen, FolderUp, RefreshCw, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { useSymbolLibrary } from "#/components/editor/useSymbolLibrary.ts";
import { panelIconButtonClassName } from "#/components/viewer/viewControlStyles.ts";
import type {
	ConfiguredSymbolLibrary,
	LibraryScope,
} from "#/symbol-library/config.ts";
import exampleSymbolUrl from "#/symbol-library/examples/test-point.ecadsym?url";

export function SymbolLibraryControls({
	library,
	feedback = true,
}: {
	library: ReturnType<typeof useSymbolLibrary>;
	feedback?: boolean;
}) {
	const [scope, setScope] = useState<LibraryScope>(library.defaultScope);
	const [name, setName] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const directoryInput = useRef<HTMLInputElement>(null);
	const {
		loading,
		userLibraries,
		projectLibraries,
		hasProject,
		upload,
		canOpenDirectory,
		openDirectory,
		refresh,
		message,
		error,
	} = library;
	return (
		<div className="flex flex-col gap-4 text-fg">
			<LibraryList
				title="User libraries"
				scope="user"
				libraries={userLibraries}
				library={library}
			/>
			{hasProject && (
				<LibraryList
					title="Project libraries"
					scope="project"
					libraries={projectLibraries}
					library={library}
				/>
			)}
			<section className="flex flex-col gap-3 border-t border-line-subtle pt-4">
				<h3 className="ui-section-label m-0">Add a library</h3>
				<div className="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1">
					<label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-fg-muted">
						Add library to
						<select
							aria-label="Library scope"
							value={scope}
							disabled={loading}
							onChange={(event) =>
								setScope(event.currentTarget.value as LibraryScope)
							}
							className="ui-select h-8 w-full"
						>
							<option value="user">User libraries</option>
							{hasProject && <option value="project">Project libraries</option>}
						</select>
					</label>
					<label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-fg-muted">
						Library name
						<input
							aria-label="Library name"
							value={name}
							disabled={loading}
							maxLength={100}
							placeholder={
								scope === "project" ? "Project symbols" : "Imported symbols"
							}
							onChange={(event) => setName(event.currentTarget.value)}
							className="ui-input h-8 w-full"
						/>
					</label>
				</div>
				<input
					ref={input}
					type="file"
					multiple
					accept=".ecadsym,.json"
					aria-label="Upload symbol files"
					className="hidden"
					disabled={loading}
					onChange={(event) => {
						const files = Array.from(event.currentTarget.files ?? []);
						event.currentTarget.value = "";
						if (files.length) void upload(files, false, scope, name);
					}}
				/>
				<input
					ref={directoryInput}
					type="file"
					multiple
					{...{ webkitdirectory: "" }}
					aria-label="Upload symbol directory"
					className="hidden"
					disabled={loading}
					onChange={(event) => {
						const files = Array.from(event.currentTarget.files ?? []);
						event.currentTarget.value = "";
						if (files.length) void upload(files, true, scope, name);
					}}
				/>
				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						disabled={loading}
						onClick={() => input.current?.click()}
						className="ui-button"
						data-variant="secondary"
					>
						<Upload size={14} aria-hidden="true" />
						Upload symbols
					</button>
					<button
						type="button"
						disabled={loading}
						onClick={() => directoryInput.current?.click()}
						className="ui-button"
						data-variant="secondary"
					>
						<FolderUp size={14} aria-hidden="true" />
						Upload library directory
					</button>
					{canOpenDirectory && (
						<button
							type="button"
							disabled={loading}
							onClick={() => void openDirectory(scope, name)}
							className="ui-button"
							data-variant="secondary"
						>
							<FolderOpen size={14} aria-hidden="true" />
							Add library directory
						</button>
					)}
					<button
						type="button"
						disabled={loading}
						onClick={() => void refresh()}
						className="ui-button"
						data-variant="ghost"
					>
						<RefreshCw size={14} aria-hidden="true" />
						Reload libraries
					</button>
				</div>
				<p className="m-0 text-xs text-fg-faint">
					One symbol per .ecadsym or .json file.{" "}
					<a
						href={exampleSymbolUrl}
						download="test-point.ecadsym"
						className="rounded-sm text-fg-muted underline underline-offset-2 hover:text-fg"
					>
						Download example
					</a>
				</p>
				{feedback && message && (
					<output className="block text-xs text-success">{message}</output>
				)}
				{feedback && error && (
					<p
						role="alert"
						className="m-0 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-danger"
					>
						{error}
					</p>
				)}
			</section>
		</div>
	);
}

function LibraryList({
	title,
	scope,
	libraries,
	library,
}: {
	title: string;
	scope: LibraryScope;
	libraries: readonly ConfiguredSymbolLibrary[];
	library: ReturnType<typeof useSymbolLibrary>;
}) {
	return (
		<fieldset aria-label={title} className="m-0 min-w-0 border-0 p-0">
			<legend className="ui-section-label mb-1.5 p-0">{title}</legend>
			{!libraries.length && (
				<p className="m-0 text-xs text-fg-faint">No libraries configured.</p>
			)}
			{libraries.map((entry) => (
				<div
					key={entry.id}
					className="-mx-1.5 flex min-h-8 items-center gap-2 rounded-md px-1.5 hover:bg-hover"
				>
					<label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-1 text-sm">
						<input
							type="checkbox"
							className="ui-checkbox"
							checked={entry.enabled}
							disabled={library.loading}
							onChange={() => void library.toggle(entry.id, scope)}
						/>
						<span className="break-words">{entry.name}</span>
					</label>
					{entry.source.kind !== "builtin" &&
						!(scope === "project" && entry.id === "project-symbols") && (
							<button
								type="button"
								aria-label={`Remove ${entry.name}`}
								disabled={library.loading}
								onClick={() => void library.remove(entry.id, scope)}
								className={`${panelIconButtonClassName} hover:text-danger`}
							>
								<Trash2 size={14} aria-hidden="true" />
							</button>
						)}
				</div>
			))}
		</fieldset>
	);
}
