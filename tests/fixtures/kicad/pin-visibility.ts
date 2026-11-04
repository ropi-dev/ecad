export const visibilityCases = [
	{ showName: false, showNumber: false },
	{ showName: false, showNumber: true },
	{ showName: true, showNumber: false },
	{ showName: true, showNumber: true },
];
export const pinVisibilitySource = `(kicad_sch (version 20250114) (paper "A3")
 (lib_symbols ${visibilityCases
		.map(
			({ showName, showNumber }, index) => `(symbol "Visibility${index}"
  (pin_names ${showName ? "" : "(hide yes)"}) (pin_numbers ${showNumber ? "" : "(hide yes)"})
  (symbol "Visibility${index}_1_1" (pin input line (at -8 0 0) (length 4) (name "Signal${index}") (number "${index + 1}"))))`,
		)
		.join("")})
 ${visibilityCases.map((_, index) => `(symbol (lib_id "Visibility${index}") (at ${190 + (index % 2) * 35} ${135 + Math.floor(index / 2) * 25} 0) (unit 1) (uuid "visibility-${index}") (property "Reference" "J${index + 1}" (at 0 0 0) (effects hide)))`).join("")})`;
