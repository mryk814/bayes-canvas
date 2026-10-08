import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, previewCsv, CSV_EXAMPLES } from "../shared/csv.ts";

const mapping = { columns: { temperature: "temp", strength: "load", group: "batch" }, units: { temperature: "K", strength: "kPa" } };

test("CSV accepts BOM, CRLF and quoted commas, escaped quotes and newlines", () => {
  const parsed = parseCsv('\uFEFFtemp,load,batch\r\n300,1200,"A, ""one""\r\nnext"\r\n');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.headers, ["temp", "load", "batch"]);
  assert.deepEqual(parsed.records, [["300", "1200", 'A, "one"\r\nnext']]);
});

test("CSV rejects duplicate headers, wrong width and malformed quotes", () => {
  for (const text of ['temp,temp,batch\n1,2,A', 'temp,load,batch\n1,2', 'temp,load,batch\n1,2,"A', 'temp,load,batch\n1,2,A"', 'temp,load,batch\n1,2,"A"x']) {
    assert.ok(parseCsv(text).errors.length > 0, text);
  }
});

test("preview converts explicitly mapped units and records provenance", () => {
  const preview = previewCsv("temp,load,batch,note\n300,1200,A,test", mapping);
  assert.equal(preview.canImport, true);
  assert.ok(Math.abs(preview.rows[0].temperature - 26.85) < 1e-10);
  assert.equal(preview.rows[0].strength, 1.2);
  assert.equal(preview.rows[0].group, "A");
  assert.deepEqual(preview.provenance.columns, mapping.columns);
  assert.deepEqual(preview.provenance.sourceUnits, mapping.units);
  assert.deepEqual(preview.provenance.targetUnits, { temperature: "C", strength: "MPa" });
  assert.ok(preview.issues.some(issue => issue.severity === "warning" && issue.column === "note"));
});

test("invalid rows block all import output instead of coercing values to zero", () => {
  for (const bad of [",1200,A", "NaN,1200,A", "Infinity,1200,A", "0x10,1200,A", "300, ,A", "300,1200, "]) {
    const preview = previewCsv(`temp,load,batch\n300,1200,A\n${bad}`, mapping);
    assert.equal(preview.canImport, false, bad);
    assert.deepEqual(preview.rows, []);
    assert.ok(preview.issues.some(issue => issue.severity === "error" && issue.row === 3));
  }
});

test("group identities retain original whitespace while whitespace-only groups remain invalid", () => {
  const preview = previewCsv("temp,load,batch\n300,1200, A\n300,1200,A\n300,1200,A ", mapping);
  assert.equal(preview.canImport, true);
  assert.deepEqual(preview.rows.map(row => row.group), [" A", "A", "A "]);
  assert.equal(previewCsv("temp,load,batch\n300,1200,   ", mapping).canImport, false);
});

test("unknown units, nonexistent/reused columns, empty data and absolute-zero violation block import", () => {
  const text = "temp,load,batch\n300,1200,A";
  for (const config of [
    { ...mapping, units: { temperature: "F", strength: "kPa" } },
    { ...mapping, units: { temperature: "K", strength: "psi" } },
    { ...mapping, columns: { ...mapping.columns, group: "missing" } },
    { ...mapping, columns: { ...mapping.columns, strength: "temp" } },
  ]) assert.equal(previewCsv(text, config).canImport, false);
  assert.equal(previewCsv("temp,load,batch", mapping).canImport, false);
  assert.equal(previewCsv("temp,load,batch\n-1,1200,A", mapping).canImport, false);
});

test("synthetic examples have explicit configuration and successful previews", () => {
  assert.equal(CSV_EXAMPLES.length, 2);
  for (const example of CSV_EXAMPLES) assert.equal(previewCsv(example.text, example.mapping).canImport, true);
});
