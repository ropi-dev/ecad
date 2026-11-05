import type { Circuit, CircuitNet } from "@ecad/drawing-core/circuit/model.ts";
import type { CircuitCommand } from "@ecad/drawing-core/circuit/store.ts";
import type { CircuitSelection } from "#/components/circuit/circuitEditorState.ts";

export type CircuitMenu = {
	selection: NonNullable<CircuitSelection>;
	x: number;
	y: number;
};

/**
 * Places the context menu at the pointer, or near the canvas corner for a
 * keyboard-opened menu, keeping it inside the canvas.
 */
export function circuitMenuPosition(
	event: { clientX: number; clientY: number },
	bounds: DOMRect,
) {
	return {
		x: Math.max(
			0,
			Math.min(
				(Number.isFinite(event.clientX) ? event.clientX : bounds.x + 20) -
					bounds.x,
				bounds.width - 190,
			),
		),
		y: Math.max(
			0,
			Math.min(
				(Number.isFinite(event.clientY) ? event.clientY : bounds.y + 20) -
					bounds.y,
				bounds.height - 150,
			),
		),
	};
}

/** The context menu's actions for the pin, connection, net or component. */
export function circuitMenuActions(
	menu: CircuitMenu | null,
	{
		circuit,
		pinNets,
		checkedPins,
		run,
		startConnecting,
		edit,
		deleteSelection,
	}: {
		circuit: Circuit;
		pinNets: ReadonlyMap<string, CircuitNet>;
		checkedPins: string[];
		run(command: CircuitCommand): boolean;
		startConnecting(pinId: string): void;
		edit(item: NonNullable<CircuitSelection>): void;
		deleteSelection(item: CircuitSelection): void;
	},
): { label: string; disabled?: boolean; run(): void }[] {
	const menuPin = menu?.selection.kind === "pin" ? menu.selection.id : null;
	const splitNet =
		menu?.selection.kind === "connection"
			? pinNets.get(menu.selection.id)
			: undefined;
	const splitPins =
		menu?.selection.kind === "connection" &&
		checkedPins.includes(menu.selection.id)
			? checkedPins
			: menu?.selection.kind === "connection"
				? [menu.selection.id]
				: [];
	return !menu
		? []
		: menuPin
			? [
					{
						label: "Connect",
						run: () => startConnecting(menuPin),
					},
					{
						label: "Disconnect",
						disabled: !pinNets.has(menuPin),
						run: () => {
							run({ type: "disconnect", pinIds: [menuPin] });
						},
					},
					{
						label: circuit.noConnectPinIds.includes(menuPin)
							? "Allow connection"
							: "No connect",
						run: () => {
							run({
								type: "no-connect",
								pinId: menuPin,
								enabled: !circuit.noConnectPinIds.includes(menuPin),
							});
						},
					},
				]
			: menu.selection.kind === "connection"
				? [
						{ label: "Disconnect", run: () => deleteSelection(menu.selection) },
						{
							label: "Split net",
							disabled:
								!splitNet ||
								splitPins.length >= splitNet.pinIds.length ||
								splitPins.some((id) => pinNets.get(id)?.id !== splitNet.id),
							run: () => {
								if (splitNet)
									run({
										type: "split-net",
										netId: splitNet.id,
										pinIds: splitPins,
									});
							},
						},
					]
				: [
						{
							label:
								menu.selection.kind === "net" ? "Rename net" : "Edit component",
							run: () => edit(menu.selection),
						},
						{
							label:
								menu.selection.kind === "net"
									? "Delete net"
									: "Delete component",
							run: () => deleteSelection(menu.selection),
						},
					];
}
