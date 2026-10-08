import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, unlinkSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Store } from "../server/store.ts";
import { replayExpertConversation } from "../experiments/expert-persona/replay.ts";

test("expert dialogue replays through real Store without adopting model or knowledge", () => {
  const report = replayExpertConversation([
    { expert: "この横並びは材料の天井？", assistant: { message: "記録上限はありますか？", candidates: [] } },
    { expert: "520以上は520と記録する設定です。", assistant: { message: "材料の上限とは分けて考えましょう。", candidates: [
      { label: "記録上限", kind: "observation_process", statement: "520以上を520と記録している", reasoning: "担当者の説明" },
    ] } },
  ]);
  assert.equal(report.turns, 2);
  assert.equal(report.threadMessages, 4);
  assert.equal(report.candidates, 1);
  assert.equal(report.stateUnchangedOutsideIntent, true);
  assert.equal(report.status, "answered");
});

test("malformed transcript rejects before replay and candidate edits are out of this smoke test", () => {
  assert.throws(() => replayExpertConversation([]));
  assert.throws(() => replayExpertConversation([{ expert: "", assistant: { message: "?", candidates: [] } }]));
  assert.throws(() => replayExpertConversation([{ expert: "?", assistant: { message: "?", candidates: [{ label: "x", kind: "invented", statement: "x", reasoning: "" }] } }]));
  assert.throws(() => replayExpertConversation([{ expert: "?", assistant: { message: "?", candidates: [{ label: "x", kind: "hypothesis", statement: "x", reasoning: "", edit: {} }] } }]));
});

test("recorded cold-context dialogue belongs to the public synthetic case and survives Store replay", () => {
  const read = (file: string) => JSON.parse(readFileSync(new URL(`../experiments/expert-persona/${file}`, import.meta.url), "utf8"));
  const data = read("public-case.json"), transcript = read("transcripts/smoke.json");
  assert.equal(data.provenance, "synthetic");
  assert.equal(data.id, transcript.caseId);
  assert.equal(data.opening, transcript.turns[0].expert);
  assert.equal(new Set(data.rows.map((r: { id: string }) => r.id)).size, data.rows.length);
  assert.equal(transcript.toolConnection, false);
  assert.deepEqual(replayExpertConversation(transcript.turns), read("transcripts/replay-result.json"));
});

test("an interrupted Store write keeps the original error and cleans its temporary file", () => {
  const failure = new Error("simulated persist failure");
  let directory = "";
  const mocked = mock.method(Store.prototype, "reply", function(this: Store) {
    directory = dirname(this.path);
    writeFileSync(this.path + ".tmp", "incomplete synthetic write");
    throw failure;
  });
  try {
    assert.throws(() => replayExpertConversation([{ expert: "?", assistant: { message: "?", candidates: [] } }]), error => error === failure);
    assert.equal(existsSync(directory), false);
  } finally {
    mocked.mock.restore();
    if (directory && existsSync(directory)) {
      for (const name of ["synthetic.json", "synthetic.json.bak", "synthetic.json.tmp"]) {
        const path = join(directory, name); if (existsSync(path)) unlinkSync(path);
      }
      rmdirSync(directory);
    }
  }
});
