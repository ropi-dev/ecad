import {
	attributeEntriesError,
	SYMBOL_ATTRIBUTE_LIMIT,
	SYMBOL_ATTRIBUTE_NAME_LIMIT,
	SYMBOL_ATTRIBUTE_VALUE_LIMIT,
} from "@ecad/drawing-core/drawing/symbol-attributes.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import {
	createSignal,
	createStore,
	createUniqueId,
	For,
	onSettled,
	Show,
} from "solid-js";
import { AppDialog, dialogBodyClassName } from "#/components/ui/Dialog.tsx";
import { Plus, Tags, Trash2 } from "#/components/ui/icons.tsx";

interface Row {
	key: number;
	name: string;
	value: string;
}

function AttributeRow(props: {
	row: Row;
	index: number;
	focus: boolean;
	onFocused: () => void;
	onChange: (field: "name" | "value", text: string) => void;
	onRemove: () => void;
}) {
	let name!: HTMLInputElement;
	onSettled(() => {
		if (!props.focus) return;
		props.onFocused();
		name.focus();
	});
	return (
		<div class="contents">
			<input
				ref={name}
				aria-label={`Attribute ${props.index + 1} name`}
				class="ui-input h-8 w-full"
				maxlength={SYMBOL_ATTRIBUTE_NAME_LIMIT}
				value={props.row.name}
				placeholder="Manufacturer"
				onInput={(event) => props.onChange("name", event.currentTarget.value)}
			/>
			<input
				aria-label={`Attribute ${props.index + 1} default value`}
				class="ui-input h-8 w-full"
				maxlength={SYMBOL_ATTRIBUTE_VALUE_LIMIT}
				value={props.row.value}
				onInput={(event) => props.onChange("value", event.currentTarget.value)}
			/>
			<button
				type="button"
				class="ui-button"
				data-variant="ghost"
				data-size="md"
				aria-label={`Remove attribute ${props.index + 1}`}
				title="Remove attribute"
				onClick={() => props.onRemove()}
			>
				<Trash2 size={14} aria-hidden="true" />
			</button>
		</div>
	);
}

export function SymbolAttributesDialog(props: {
	attributes: Readonly<Record<string, string>> | undefined;
	onSave: (attributes: Record<string, string>) => void | Promise<void>;
	onClose: () => void;
}) {
	const formId = createUniqueId();
	let nextKey = 0;
	let focusKey: number | undefined;
	const [rows, setRows] = createStore<Row[]>(
		() =>
			Object.entries(props.attributes ?? {}).map(([name, value]) => ({
				key: nextKey++,
				name,
				value,
			})),
		[],
	);
	const [error, setError] = createSignal("");
	const change = (key: number, field: "name" | "value", text: string) =>
		setRows((current) => {
			const row = current.find((entry) => entry.key === key);
			if (row) row[field] = text;
		});

	return (
		<AppDialog
			open
			onOpenChange={(open) => {
				if (!open) props.onClose();
			}}
			title="Symbol attributes"
			description="Every new placement of this symbol gets these attributes with their default values. Name, reference and value are always present."
			footer={
				<>
					<button
						type="button"
						class="ui-button"
						data-variant="ghost"
						data-size="md"
						onClick={() => props.onClose()}
					>
						Cancel
					</button>
					<button
						type="submit"
						form={formId}
						class="ui-button"
						data-variant="primary"
						data-size="md"
					>
						Save
					</button>
				</>
			}
		>
			<form
				id={formId}
				class={[
					dialogBodyClassName,
					"flex max-h-[min(36rem,calc(100dvh-12rem))] flex-col gap-3",
				]}
				novalidate
				onSubmit={async (event) => {
					event.preventDefault();
					const entries = rows.map(
						({ name, value }) => [name.trim(), value] as const,
					);
					const problem = attributeEntriesError(entries);
					if (problem) {
						setError(problem.message);
						return;
					}
					try {
						await props.onSave(Object.fromEntries(entries));
						props.onClose();
					} catch (cause) {
						setError(errorMessage(cause, "Unable to save the attributes."));
					}
				}}
			>
				<Show
					when={rows.length > 0}
					fallback={
						<p class="m-0 text-sm text-fg-muted">
							This symbol has no attributes of its own yet.
						</p>
					}
				>
					<div class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-x-2 gap-y-2">
						<span class="text-xs font-medium text-fg-muted">Name</span>
						<span class="text-xs font-medium text-fg-muted">Default value</span>
						<span />
						<For each={rows}>
							{(row, index) => (
								<AttributeRow
									row={row}
									index={index()}
									focus={focusKey === row.key}
									onFocused={() => {
										focusKey = undefined;
									}}
									onChange={(field, text) => change(row.key, field, text)}
									onRemove={() =>
										setRows((current) =>
											current.filter((entry) => entry.key !== row.key),
										)
									}
								/>
							)}
						</For>
					</div>
				</Show>
				<div>
					<button
						type="button"
						class="ui-button"
						data-variant="secondary"
						data-size="md"
						disabled={rows.length >= SYMBOL_ATTRIBUTE_LIMIT}
						onClick={() => {
							const key = nextKey++;
							focusKey = key;
							setRows((current) => {
								current.push({ key, name: "", value: "" });
							});
						}}
					>
						<Plus size={14} aria-hidden="true" />
						Add attribute
					</button>
				</div>
				<Show when={error()}>
					<p role="alert" class="m-0 text-sm text-danger">
						{error()}
					</p>
				</Show>
			</form>
		</AppDialog>
	);
}

export function SymbolAttributesButton(props: {
	attributes: Readonly<Record<string, string>> | undefined;
	onSave: (attributes: Record<string, string>) => void | Promise<void>;
}) {
	const [open, setOpen] = createSignal(false);
	return (
		<>
			<button
				type="button"
				class="ui-button"
				data-variant="secondary"
				onClick={() => setOpen(true)}
			>
				<Tags size={14} aria-hidden="true" />
				Attributes
			</button>
			<Show when={open()}>
				<SymbolAttributesDialog
					attributes={props.attributes}
					onSave={props.onSave}
					onClose={() => setOpen(false)}
				/>
			</Show>
		</>
	);
}
