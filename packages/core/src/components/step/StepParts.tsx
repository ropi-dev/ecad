import type { ParsedStepFile } from "#/formats/parseStepFile.ts";

export function StepParts({
	model,
	hidden,
	onToggle,
	onClear,
}: {
	model: ParsedStepFile;
	hidden: Set<number>;
	onToggle: (index: number) => void;
	onClear: () => void;
}) {
	return (
		<aside
			aria-label="Model parts"
			className="ui-panel absolute top-[calc(var(--chrome-top)+var(--chrome-bar))] right-[var(--chrome-right)] z-10 flex max-h-[40%] w-60 flex-col overflow-hidden sm:top-[var(--chrome-top)] sm:max-h-[calc(100%-var(--chrome-top)-var(--chrome-dock))] sm:w-72"
		>
			<header className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-line-subtle py-1.5 pr-1.5 pl-3">
				<h2 className="m-0 truncate text-sm font-semibold" title={model.name}>
					{model.name}
				</h2>
				<button
					type="button"
					className="ui-button"
					data-variant="ghost"
					onClick={onClear}
				>
					Close
				</button>
			</header>
			<ul className="m-0 min-h-0 list-none overflow-y-auto p-1.5">
				{model.parts.map((part, index) => (
					<li key={part.id}>
						<label className="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-sm hover:bg-hover pointer-coarse:min-h-11">
							<input
								type="checkbox"
								checked={!hidden.has(index)}
								onChange={() => onToggle(index)}
								className="ui-checkbox"
							/>
							<span
								className="truncate"
								title={part.name || `Part ${index + 1}`}
							>
								{part.name || `Part ${index + 1}`}
							</span>
						</label>
					</li>
				))}
			</ul>
		</aside>
	);
}
