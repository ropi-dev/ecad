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

The nRF54L15, nRF54L10, nRF54L05, and nPM2100 definitions are not adapted from
the KiCad libraries, which have no symbols for these parts. ECAD drew them from
the pin assignment tables in Nordic Semiconductor's datasheets:

- nRF54L15, nRF54L10, and nRF54L05 Wireless SoCs Datasheet v1.0 (4503_018),
  section 10.1, QFN40 (QDAA), QFN48 (QFAA), QFN52 (QGAA), and CSP47 (CAAA)
  package pin assignments, and section 14.4 order codes:
  https://docs.nordicsemi.com/bundle/ps_nrf54l15/page/chapters/pin.html
- nPM2100 Power Management IC Datasheet v1.0, QFN (QEAA) and WLCSP (CAAA)
  pin assignments:
  https://docs.nordicsemi.com/bundle/ps_npm2100/page/about.html

Each package has its own symbol because pin numbering differs between packages.
All three nRF54L parts are sold in QDAA, QFAA, and QGAA. Only the nRF54L15 is
sold in CAAA. Packages with the same code share one layout. The QFN exposed pad
is VSS, numbered 41, 49, or 53. The nPM2100 QFN exposed pad is AVSS1, numbered
17. Ball-grid packages use ball names as pin numbers, and CSP47 has no B2 or C1
ball. GPIO names carry the crystal, NFC, analog input, and external reference
functions from the datasheet. nRESET denotes active-low reset.
