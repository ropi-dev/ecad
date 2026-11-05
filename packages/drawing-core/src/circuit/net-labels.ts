import type { Circuit } from "#/circuit/model.ts";

export function circuitNetLabels(circuit: Circuit): Map<string, string> {
	const labels = new Map(
		circuit.nets
			.filter((net) => net.names.length)
			.map((net) => [net.id, net.names[0]]),
	);
	const automatic = circuit.nets.filter((net) => !net.names.length);
	if (!automatic.length) return labels;
	const pins = new Map(
		circuit.components.flatMap((component) =>
			component.pins.map(
				(pin) =>
					[
						pin.id,
						{
							name: /^(?:\d+|~)?$/.test(pin.name.trim()) ? "" : pin.name.trim(),
							fallback: `${component.reference}.${pin.number}`,
						},
					] as const,
			),
		),
	);
	const used = new Set(circuit.nets.flatMap((net) => net.names));
	const suffixes = new Map<string, number>();
	const indexes = new Map(
		circuit.nets.map((net, index) => [net.id, index + 1]),
	);
	for (const net of automatic.sort((a, b) =>
		a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
	)) {
		const members = net.pinIds.flatMap((id) => {
			const pin = pins.get(id);
			return pin ? [pin] : [];
		});
		const named = members.map((pin) => pin.name).filter(Boolean);
		const names = [
			...new Set(named.length ? named : members.map((pin) => pin.fallback)),
		].sort();
		const base = (
			names.length
				? names.slice(0, 3).join(" / ") +
					(names.length > 3 ? ` +${names.length - 3}` : "")
				: `Net ${indexes.get(net.id)}`
		).slice(0, 180);
		let label = base;
		let suffix = suffixes.get(base) ?? 2;
		while (used.has(label)) label = `${base}_${suffix++}`;
		suffixes.set(base, suffix);
		used.add(label);
		labels.set(net.id, label);
	}
	return labels;
}
