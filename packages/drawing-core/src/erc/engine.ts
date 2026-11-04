import type {
	Circuit,
	CircuitComponent,
	CircuitNet,
	CircuitPin,
} from "#/circuit/model.ts";
import { errorMessage } from "#/lib/error-message.ts";
import { measurePerformance } from "#/performance/runtime.ts";

type ReadonlyData<T> = T extends readonly (infer Item)[]
	? readonly ReadonlyData<Item>[]
	: T extends object
		? { readonly [Key in keyof T]: ReadonlyData<T[Key]> }
		: T;
export type ErcSeverity = "error" | "warning";
export type ErcSubject = {
	readonly kind: "pin" | "net" | "component";
	readonly id: string;
};
export type ErcFinding = {
	readonly code?: string;
	readonly target?: ErcSubject;
	readonly message: string;
	readonly subjects: readonly ErcSubject[];
};
export type ErcDiagnostic = ErcFinding & {
	readonly id: string;
	readonly ruleId: string;
	readonly severity: ErcSeverity;
};
export type ErcPin = {
	readonly pin: ReadonlyData<CircuitPin>;
	readonly component: ReadonlyData<CircuitComponent>;
};
export interface ErcContext {
	readonly circuit: ReadonlyData<Circuit>;
	readonly pins: ReadonlyMap<string, ErcPin>;
	readonly netsByPin: ReadonlyMap<string, ReadonlyData<CircuitNet>>;
	readonly pinsByNet: ReadonlyMap<string, readonly ErcPin[]>;
	readonly noConnect: ReadonlySet<string>;
}
export interface ErcRule {
	readonly id: string;
	readonly title: string;
	readonly severity: ErcSeverity;
	check(context: ErcContext): Iterable<ErcFinding>;
}
export interface ErcOptions {
	readonly severity?: Readonly<Record<string, ErcSeverity | "off">>;
}

export function runErc(
	circuit: ReadonlyData<Circuit>,
	rules: readonly ErcRule[],
	options: ErcOptions = {},
): ErcDiagnostic[] {
	const ids = new Set<string>();
	for (const rule of rules) {
		if (!rule.id.trim() || ids.has(rule.id))
			throw new Error(`Invalid or duplicate ERC rule ID: ${rule.id}`);
		ids.add(rule.id);
	}
	return measurePerformance(
		"circuit.erc",
		() => {
			const pins = new Map<string, ErcPin>();
			for (const component of circuit.components)
				for (const pin of component.pins) pins.set(pin.id, { pin, component });
			const netsByPin = new Map<string, ReadonlyData<CircuitNet>>();
			const pinsByNet = new Map<string, ErcPin[]>();
			for (const net of circuit.nets) {
				const members: ErcPin[] = [];
				for (const id of net.pinIds) {
					netsByPin.set(id, net);
					const pin = pins.get(id);
					if (pin) members.push(pin);
				}
				pinsByNet.set(net.id, members);
			}
			const context: ErcContext = {
				circuit,
				pins,
				netsByPin,
				pinsByNet,
				noConnect: new Set(circuit.noConnectPinIds),
			};
			const diagnostics = new Map<string, ErcDiagnostic>();
			for (const rule of rules) {
				const override =
					options.severity && Object.hasOwn(options.severity, rule.id)
						? options.severity[rule.id]
						: undefined;
				const severity = override ?? rule.severity;
				if (severity === "off") continue;
				try {
					for (const finding of rule.check(context)) {
						const subjects = [
							...new Map(
								finding.subjects.map((subject) => [
									JSON.stringify([subject.kind, subject.id]),
									{ ...subject },
								]),
							).values(),
						];
						const id = JSON.stringify([
							rule.id,
							finding.code ?? "",
							subjects.map((subject) => [subject.kind, subject.id]).sort(),
						]);
						diagnostics.set(id, {
							...finding,
							subjects,
							...(finding.target ? { target: { ...finding.target } } : {}),
							id,
							ruleId: rule.id,
							severity,
						});
					}
				} catch (cause) {
					throw new Error(
						`ERC rule "${rule.id}" failed: ${errorMessage(cause)}`,
						{ cause },
					);
				}
			}
			return [...diagnostics.values()].sort(
				(a, b) =>
					(a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1) ||
					a.id.localeCompare(b.id),
			);
		},
		{
			components: circuit.components.length,
			nets: circuit.nets.length,
			rules: rules.length,
		},
	);
}
