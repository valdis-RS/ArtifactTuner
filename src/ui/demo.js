// Made-up example data so the page opens in a working state. Nothing here
// comes from a real ECU.

export function demoFiles() {
  const bin = new Uint8Array(0x200);
  const rpm = Array.from({ length: 16 }, (_, i) => 32 * (25 + 12 * i));     // 800 … 6560 rpm
  const load = [8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 90, 100];              // %
  const coolant = [24, 40, 56, 72, 88, 104, 128, 152, 176, 200];               // raw; X*0.75-48 = °C
  rpm.forEach((v, i) => { bin[0x00 + i] = v / 32; });
  load.forEach((v, i) => { bin[0x10 + i] = v * 2; });
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 12; c++) {
      const advance = 8 + 30 * Math.sqrt(rpm[r] / 6560) - 18 * (load[c] / 100) ** 1.5;
      bin[0x20 + r * 12 + c] = Math.round((advance + 23.625) / 0.375);
    }
  }
  coolant.forEach((raw, i) => {
    bin[0xe0 + i] = raw;
    const t = raw * 0.75 - 48;
    const factor = Math.round((1 + 0.6 * Math.exp(-(t + 30) / 35)) * 32768);
    bin[0xea + 2 * i] = factor & 0xff;
    bin[0xeb + 2 * i] = factor >> 8;
  });
  bin[0x100] = 205;                                                           // 205 × 32 = 6560 rpm
  return { xdfText: XDF, bin, binName: 'example.bin' };
}

const XDF = `<XDFFORMAT version="1.70">
  <XDFHEADER>
    <deftitle>Example engine (made-up data)</deftitle>
    <description>Synthetic maps that show how the editor works. Open your own XDF and BIN to start.</description>
    <BASEOFFSET offset="0" subtract="0" />
    <DEFAULTS datasizeinbits="8" sigdigits="2" />
    <REGION type="0xFFFFFFFF" startaddress="0x0" size="0x200" />
    <CATEGORY index="0x0" name="Ignition" />
    <CATEGORY index="0x1" name="Fuel" />
    <CATEGORY index="0x2" name="Limits" />
  </XDFHEADER>
  <XDFTABLE uniqueid="0x1">
    <title>Ignition advance (example)</title>
    <description>Spark advance by engine speed and load. Made-up values.</description>
    <CATEGORYMEM index="0" category="1" />
    <XDFAXIS id="x"><EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0x10" mmedelementsizebits="8" /><units>Load %</units><indexcount>12</indexcount><decimalpl>0</decimalpl><embedinfo type="1" /><MATH equation="X/2"><VAR id="X" /></MATH></XDFAXIS>
    <XDFAXIS id="y"><EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0x0" mmedelementsizebits="8" /><units>rpm</units><indexcount>16</indexcount><decimalpl>0</decimalpl><embedinfo type="1" /><MATH equation="X*32"><VAR id="X" /></MATH></XDFAXIS>
    <XDFAXIS id="z"><EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0x20" mmedelementsizebits="8" mmedrowcount="16" mmedcolcount="12" /><units>° BTDC</units><decimalpl>2</decimalpl><MATH equation="X*0.375-23.625"><VAR id="X" /></MATH></XDFAXIS>
  </XDFTABLE>
  <XDFTABLE uniqueid="0x2">
    <title>Warm-up enrichment (example)</title>
    <description>Fuel multiplier by coolant temperature. Made-up values.</description>
    <CATEGORYMEM index="0" category="2" />
    <XDFAXIS id="x"><EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0xE0" mmedelementsizebits="8" /><units>Coolant °C</units><indexcount>10</indexcount><decimalpl>0</decimalpl><embedinfo type="1" /><MATH equation="X*0.75-48"><VAR id="X" /></MATH></XDFAXIS>
    <XDFAXIS id="y"><indexcount>1</indexcount><LABEL index="0" value="-" /></XDFAXIS>
    <XDFAXIS id="z"><EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0xEA" mmedelementsizebits="16" mmedrowcount="1" mmedcolcount="10" /><units>factor</units><decimalpl>3</decimalpl><MATH equation="X/32768"><VAR id="X" /></MATH></XDFAXIS>
  </XDFTABLE>
  <XDFCONSTANT uniqueid="0x3">
    <title>Rev limit (example)</title>
    <description>Fuel-cut engine speed. Made-up value.</description>
    <CATEGORYMEM index="0" category="3" />
    <EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0x100" mmedelementsizebits="8" />
    <units>rpm</units>
    <decimalpl>0</decimalpl>
    <MATH equation="X*32"><VAR id="X" /></MATH>
  </XDFCONSTANT>
</XDFFORMAT>`;
