/** EAN-13 helpers. Internal barcodes use the in-store prefix range 200–299. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Internal EAN-13 from a numeric product id: 2 + 0 + 10-digit id + check digit. */
export function internalEan13(productId: number): string {
  const body = `20${String(productId).padStart(10, '0')}`;
  return body + ean13CheckDigit(body);
}
