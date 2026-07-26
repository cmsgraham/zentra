// Sanity check for the accent-folding used to match spoken list names.
// Run with: node fold.test.mjs
function fold(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

const cases = [
  ['Casa', 'casa'],
  ['OFICINA', 'oficina'],
  ['  Bodega  ', 'bodega'],
  ['Almacén', 'almacen'],
  ['Niño', 'nino'],
  ['', ''],
];

let bad = 0;
for (const [input, expected] of cases) {
  const got = fold(input);
  if (got !== expected) {
    console.error(`FAIL fold(${JSON.stringify(input)}) = ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    bad++;
  }
}
console.log(bad === 0 ? `ok — ${cases.length} cases passed` : `${bad} failing`);
process.exit(bad === 0 ? 0 : 1);
