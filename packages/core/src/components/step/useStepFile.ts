import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { Effect } from "effect";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import { useFileImport } from "#/components/viewer/useFileImport.ts";
import { ImportOwnership } from "#/formats/import-ownership.ts";
import {
	type ParsedStepFile,
	parseStepFileEffect,
} from "#/formats/parseStepFile.ts";
import { useProjectActions } from "#/projects/ProjectProvider.tsx";

function readStep(file: File) {
	return Effect.map(parseStepFileEffect(file), (value) => ({ value }));
}

const release = (model: ParsedStepFile) => model.dispose();

async function sameFile(a: File, b: File) {
	if (a === b) return true;
	if (a.name !== b.name || a.size !== b.size) return false;
	const [left, right] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
	const x = new Uint8Array(left),
		y = new Uint8Array(right);
	for (let index = 0; index < x.length; index++)
		if (x[index] !== y[index]) return false;
	return true;
}

export function useStepFile() {
	const actions = useProjectActions();
	const [restoreError, setRestoreError] = createSignal("");
	const [model, updateModel] = createSignal<ParsedStepFile | null>(null);
	const ownership = new ImportOwnership();
	const setModel = (next: ParsedStepFile | null) => {
		ownership.stage(next ? [next.dispose] : []);
		updateModel(() => next);
	};
	createEffect(model, (shown) => {
		ownership.commit(shown ? [shown.dispose] : []);
	});
	onSettled(() => () => ownership.dispose());
	const files = useFileImport(
		readStep,
		release,
		undefined,
		() => "step" as const,
	);
	let restored: File | undefined;
	let generation = 0;
	const forget = () => {
		restored = undefined;
		generation++;
	};
	const openFile = async (file: File) => {
		forget();
		const models = await files.readFiles([file], (imported) => {
			if (imported.length) setModel(imported[0]);
		});
		// A successful load replaces an earlier restore problem.
		if (models?.length) setRestoreError("");
		return Boolean(models?.length);
	};
	const readAssets = createMemo(() => actions()?.readAssets);
	createEffect(readAssets, (read) => {
		let cancelled = false;
		const current = generation;
		void read?.("step")
			.then(async ({ files: assets, problems }) => {
				if (cancelled) return;
				// Assets over the size limit are named; the newest valid one loads.
				setRestoreError(problems.join(" "));
				const file = assets.at(-1);
				if (!file) return;
				if (restored && (await sameFile(restored, file))) return;
				if (cancelled || current !== generation) return;
				restored = file;
				const models = await files.readFiles(
					[file],
					(imported) => {
						if (imported.length) setModel(imported[0]);
					},
					false,
				);
				if (!models?.length && restored === file) restored = undefined;
			})
			.catch((cause: unknown) => {
				if (!cancelled)
					setRestoreError(
						errorMessage(cause, "Unable to load project assets."),
					);
			});
		return () => {
			cancelled = true;
		};
	});
	return {
		get model() {
			return model();
		},
		get loading() {
			return files.loading;
		},
		get message() {
			return [restoreError(), files.message].filter(Boolean).join("; ");
		},
		openFile,
		cancel: () => {
			forget();
			files.cancel();
		},
		clear: () => {
			forget();
			files.cancel();
			setModel(null);
			setRestoreError("");
			files.clearMessage();
		},
	};
}
