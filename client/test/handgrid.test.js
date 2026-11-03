import test from "node:test";
import assert from "node:assert/strict";
import { syncCells, placeCard, placeGroup, cellsFromGroups, nextFree, gridShape, cellItems } from "../src/handgrid.js";

test("syncCells: las cartas nuevas van a la primera casilla libre tras la última; las que se van dejan su hueco", () => {
  assert.deepEqual(syncCells([], ["a", "b", "c"]), ["a", "b", "c"]);
  assert.deepEqual(syncCells(["a", null, "b"], ["a", "b", "x"]), ["a", null, "b", "x"]);
  assert.deepEqual(syncCells(["a", "b", "c"], ["a", "c"]), ["a", null, "c"]);       // b se jugó: queda el hueco
  assert.deepEqual(syncCells(["a", "b", null, null], ["a"]), ["a"]);               // sin huecos al final
});

test("placeCard: a una casilla vacía la ocupa; sobre otra carta la empuja hasta el siguiente hueco", () => {
  assert.deepEqual(placeCard(["a", "b", "c"], "a", 4), [null, "b", "c", null, "a"]); // deja espacios de por medio
  assert.deepEqual(placeCard(["a", "b", null, "c"], "c", 0), ["c", "a", "b"]);       // empuja a y b hasta el hueco
  assert.deepEqual(placeCard(["a", "b", "c"], "c", 1), ["a", "c", "b"]);
  assert.deepEqual(placeCard(["a", "b", "c"], "a", 1), [null, "a", "b", "c"]);
});

test("placeGroup: el grupo queda junto y en orden donde lo sueltas", () => {
  assert.deepEqual(placeGroup(["x", "a", "b", "c", "y"], ["a", "b", "c"], 6), ["x", null, null, null, "y", null, "a", "b", "c"]);
  assert.deepEqual(placeGroup(["x", "y", null, "a", "b"], ["a", "b"], 0), ["a", "b", "x", "y"]);
});

test("789 / 777: una casilla vacía entre grupos (sin línea divisoria)", () => {
  const g = (...ids) => ids.map((id) => ({ id }));
  assert.deepEqual(cellsFromGroups([g("a", "b"), g("c"), g("d", "e")]), ["a", "b", null, "c", null, "d", "e"]);
  assert.equal(nextFree(["a", null, "b"]), 3);
  assert.equal(nextFree([]), 0);
});

test("gridShape: una fila mientras quepan; luego dos; y si no caben, casillas más pequeñas", () => {
  assert.deepEqual(gridShape(10, 1000, 60), { rows: 1, cols: 16, cell: 60 });
  assert.deepEqual(gridShape(20, 1000, 60), { rows: 2, cols: 16, cell: 60 });
  const big = gridShape(40, 1000, 60);
  assert.equal(big.rows, 2);
  assert.equal(big.cols, 21);
  assert.ok(big.cell < 60 && big.cell * big.cols <= 1000);
});

test("cellItems: los huecos y las cartas ocultas cortan los grupos", () => {
  const byId = new Map(["a", "b"].map((id) => [id, { id }]));
  assert.deepEqual(cellItems(["a", null, "b"], byId, new Set(["b"])), [{ card: { id: "a" } }, { gap: true }, { gap: true }]);
});
