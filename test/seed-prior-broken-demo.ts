// Synthetic-only fixture: seed 8 can render this candidate; seed 1 has an overflowing world.
import { existsSync } from "node:fs";
import { Store } from "../server/store.ts";

const path = process.argv[2];
if (!path || existsSync(path)) throw new Error("新規の検証データファイル名を指定してください。");
const store = new Store(path), model = store.startExample("curve");
const spec = structuredClone(store.version(model.currentVersionId).spec);
spec.nodes.find(node => node.name === "s20")!.dist = { family: "lognormal", args: { mu: "5", sigma: "1" } };
store.adopt(store.propose({ modelId: model.id, spec, summary: "合成検証専用：seedによる非有限値の再現", knowledgeIds: [] }).id);
