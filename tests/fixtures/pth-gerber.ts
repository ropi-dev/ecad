/** Repeated plated pads, encoded with aperture holes or ordered clear flashes. */
export function pthGerber(count: number, alternating = false): string {
	const commands = [
		"%FSLAX46Y46*%",
		"%MOMM*%",
		`%ADD10C,1.5${alternating ? "" : "X0.8"}*%`,
		"%ADD11C,0.8*%",
	];
	for (let index = 0; index < count; index++) {
		const position = `X${(index % 100) * 2500000}Y${Math.floor(index / 100) * 2500000}D03*`;
		commands.push(
			alternating
				? `%LPD*%D10*${position}%LPC*%D11*${position}`
				: `D10*${position}`,
		);
	}
	return `${commands.join("\n")}\nM02*`;
}
