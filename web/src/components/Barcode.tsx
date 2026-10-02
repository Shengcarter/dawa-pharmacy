import { isValidEan13 } from '@dawa/shared';

/*
 * Barcode rendering as SVG (no dependencies). EAN-13 for retail codes,
 * Code 128-B for anything else (SKUs, supplier codes).
 */
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function ean13Bits(code: string) {
  const d = code.split('').map(Number);
  let bits = '101';
  const parity = PARITY[d[0]];
  for (let i = 1; i <= 6; i += 1) bits += (parity[i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i += 1) bits += R[d[i]];
  return bits + '101';
}

// Code 128 patterns (bar/space widths) for values 0–106.
const C128 = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222',
  '123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321',
  '232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121',
  '313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224',
  '111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113',
  '114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112',
];

function code128Bits(text: string) {
  const values = [104, ...text.split('').map((c) => c.charCodeAt(0) - 32)];
  const checksum = values.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  let bits = '';
  for (const v of [...values, checksum, 106]) {
    C128[v].split('').forEach((w, i) => (bits += (i % 2 === 0 ? '1' : '0').repeat(Number(w))));
  }
  return bits;
}

export function Barcode({ value, height = 48, moduleWidth = 1.5, showText = true }: { value: string; height?: number; moduleWidth?: number; showText?: boolean }) {
  const printable = /^[\x20-\x7e]+$/.test(value);
  if (!printable) return null;
  const isEan = isValidEan13(value);
  const bits = isEan ? ean13Bits(value) : code128Bits(value);
  const quiet = 10;
  const width = (bits.length + quiet * 2) * moduleWidth;
  const textSpace = showText ? 14 : 0;
  const bars: { x: number; w: number }[] = [];
  for (let i = 0; i < bits.length; ) {
    if (bits[i] === '1') {
      let j = i;
      while (bits[j] === '1') j += 1;
      bars.push({ x: (i + quiet) * moduleWidth, w: (j - i) * moduleWidth });
      i = j;
    } else i += 1;
  }
  return (
    <svg width={width} height={height + textSpace} viewBox={`0 0 ${width} ${height + textSpace}`} role="img" aria-label={`Barcode ${value}`}>
      <rect width={width} height={height + textSpace} fill="#fff" />
      {bars.map((b, i) => <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#000" />)}
      {showText && (
        <text x={width / 2} y={height + 11} textAnchor="middle" fontFamily="ui-monospace, Menlo, monospace" fontSize="11" fill="#000" letterSpacing="1">
          {value}
        </text>
      )}
    </svg>
  );
}
