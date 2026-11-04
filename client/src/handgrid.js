// Tu mano como CUADRÍCULA: cada carta ocupa una casilla y las casillas vacías son los espacios que tú dejas.
// `cells` es un arreglo de ids de carta o null (casilla vacía). Funciones puras (se prueban sin navegador).

// Quita las cartas que ya no están en tu mano (su casilla queda vacía) y coloca las nuevas en la PRIMERA casilla
// vacía (también los espacios que separan grupos). Las casillas vacías del final no se guardan.
export function syncCells(cells, handIds) {
  const inHand = new Set(handIds);
  const out = cells.map((id) => (id && inHand.has(id) ? id : null));
  const placed = new Set(out.filter(Boolean));
  for (const id of handIds) {
    if (placed.has(id)) continue;
    out[nextFree(out)] = id;
    placed.add(id);
  }
  return trim(out);
}

// Mueve una carta a la casilla `target`. Si está vacía, la ocupa (y donde estaba queda un espacio). Si hay otra
// carta, la empuja hacia la derecha hasta el siguiente espacio libre.
export function placeCard(cells, id, target) {
  const out = cells.map((x) => (x === id ? null : x));
  insertAt(out, id, target);
  return trim(out);
}

// Mueve un grupo entero a partir de la casilla `target`, con sus cartas juntas y en el mismo orden.
export function placeGroup(cells, ids, target) {
  const set = new Set(ids);
  const out = cells.map((x) => (set.has(x) ? null : x));
  ids.forEach((id, i) => insertAt(out, id, target + i));
  return trim(out);
}

// Botones 789 / 777: los grupos uno tras otro, con UNA casilla vacía entre grupo y grupo.
export function cellsFromGroups(groups) {
  const out = [];
  groups.forEach((g, i) => { if (i) out.push(null); out.push(...g.map((c) => c.id)); });
  return out;
}

// Primera casilla vacía (donde cae una carta nueva): un hueco entre cartas o, si no hay, la siguiente a la última.
export function nextFree(cells) {
  const hole = cells.indexOf(null);
  return hole >= 0 ? hole : cells.length;
}

// Forma de la cuadrícula: SIEMPRE dos filas (el atril no cambia de alto). Mientras quepan con su tamaño normal, las
// casillas son de ese tamaño; si no, se hacen más angostas y las cartas se achican para caber en el mismo espacio.
// used: casillas en uso (hasta la última carta). width: ancho disponible. cellMax: tamaño normal de una casilla.
export function gridShape(used, width, cellMax) {
  const perRow = Math.max(1, Math.floor(width / cellMax));
  const cols = Math.max(perRow, Math.ceil((used + 1) / 2)); // siempre queda al menos una casilla libre
  return { rows: 2, cols, cell: Math.min(cellMax, width / cols) };
}

// Las casillas como [{card}|{gap}] (para buscar grupos de cartas juntas). hidden: ids que no se muestran.
export function cellItems(cells, byId, hidden = new Set()) {
  return cells.map((id) => (id && byId.has(id) && !hidden.has(id) ? { card: byId.get(id) } : { gap: true }));
}

// ---------- internos ----------
function trim(cells) {
  const out = [...cells];
  while (out.length && !out.at(-1)) out.pop();
  return out;
}
// Pone `id` en la casilla `target` (modifica el arreglo). Si está ocupada, corre las cartas hasta el próximo hueco.
function insertAt(cells, id, target) {
  while (cells.length < target) cells.push(null);
  if (!cells[target]) { cells[target] = id; return; }
  const hole = cells.indexOf(null, target);
  if (hole >= 0) cells.splice(hole, 1);
  cells.splice(target, 0, id);
}
