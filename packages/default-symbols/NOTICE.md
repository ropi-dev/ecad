# Symbol attribution

This collection adapts symbols by the KiCad library contributors from
https://github.com/KiCad/kicad-symbols at commit
`4e17d7595f9691d45d97aea8ad64572652fb5bed`.

Upstream source files are available at
https://github.com/KiCad/kicad-symbols/tree/4e17d7595f9691d45d97aea8ad64572652fb5bed.
The KiCad library license is included in LICENSE.md. The full CC BY-SA 4.0 text
is included in CC-BY-SA-4.0.txt. The electronic-design exception is retained.

ECAD modifications convert coordinates to the editor grid, rotate passive
components, approximate arcs with lines, use polygon outlines, omit unsupported
electrical metadata, preserve terminal names, and add reference and value labels.
The operational amplifier also has drawn input polarity marks. Existing ECAD
resistor, capacitor, and ground dimensions remain unchanged.

The original three symbols reference Device:R, Device:C, and power:Earth.
The additional source definitions are:

- `Device:R_US`
- `Device:R_Variable`
- `Device:R_Potentiometer`
- `Device:Thermistor`
- `Device:R_Photo`
- `Device:C_Polarized`
- `Device:C_Variable`
- `Device:L`
- `Device:FerriteBead`
- `Device:Transformer_1P_1S`
- `Device:Crystal`
- `Device:Fuse`
- `Device:D`
- `Device:D_Schottky`
- `Device:D_Zener`
- `Device:D_TVS`
- `Device:LED`
- `Device:D_Photo`
- `Device:Q_NPN_BCE`
- `Device:Q_PNP_BCE`
- `Device:Q_NMOS_GSD`
- `Device:Q_PMOS_GSD`
- `Device:Q_NJFET_GSD`
- `Device:Q_PJFET_GSD`
- `Switch:SW_SPST`
- `Switch:SW_SPDT`
- `Switch:SW_Push`
- `Device:Battery`
- `Device:Battery_Cell`
- `power:GND`
- `power:VCC`
- `power:VDD`
- `power:+3V3`
- `power:+5V`
- `Connector_Generic:Conn_01x02`
- `Connector_Generic:Conn_01x03`
- `Connector_Generic:Conn_01x04`
- `Connector_Generic:Conn_01x08`
- `Amplifier_Operational:LM321`
- `Device:Speaker`
- `Device:Buzzer`
- `Device:Antenna`

The microcontroller definitions adapt `MCU_RaspberryPi:RP2040`,
`MCU_RaspberryPi:RP2350A`, and `MCU_RaspberryPi:RP2350B` from the KiCad
library contributors at commit `c2457f8bcea241d7b85c34ab025fe52315febd2f`:
https://gitlab.com/kicad/libraries/kicad-symbols/-/tree/c2457f8bcea241d7b85c34ab025fe52315febd2f/MCU_RaspberryPi.kicad_symdir
These definitions preserve package pin numbers and exposed ground pads. ECAD
separates stacked supply pins, arranges GPIO and other pins in two columns,
and preserves native pin names and numbers. QSPI_SS_N denotes active-low QSPI_SS.
