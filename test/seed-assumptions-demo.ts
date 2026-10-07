// New synthetic-only fixture for assumption provenance; never opens an existing data file.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Store } from "../server/store.ts";
import { EXAMPLES } from "../shared/example.ts";

export function seedAssumptionsDemo(path: string) {
  if (!path || existsSync(path)) throw new Error("新規の検証ファイルを指定してください。既存ファイルは上書きしません。");
  const store = new Store(resolve(path));
  const examples = EXAMPLES.map(example => {
    const model = store.startExample(example.id);
    const initial = store.version(model.currentVersionId);
    const confirm = (statement: string, node: string) => {
      const intent = store.createIntent({ scene: { modelVersionId: initial.id, runId: null, seed: 31 },
        marks: [{ kind: "layer", world: 0, unit: 0, node }], utterance: `画面検証用の仮定: ${statement}` });
      store.reply({ intentId: intent.id, message: "画面検証用の候補です。実験の知識ではありません。",
        candidates: [{ label: statement, kind: "prior_knowledge", statement, reasoning: "来歴表示を確かめる合成fixture" }] });
      const candidate = store.state.intents.find(item => item.id === intent.id)!.candidates[0];
      return store.choose(intent.id, { candidateId: candidate.id }).knowledgeId;
    };
    const knowledgeIds = [confirm("20°Cでの強度は480MPa付近を想定する", "s20"),
      confirm("強度の中心についての仮定は後で取り下げる可能性がある", "s20")];
    const spec = structuredClone(initial.spec);
    spec.nodes.find(node => node.name === "s20")!.dist!.args.mu = "480";
    const proposal = store.propose({ modelId: model.id, spec, summary: "検証用:二つの知識を根拠にs20のprior中心を変更", knowledgeIds });
    const adopted = store.adopt(proposal.id);
    store.setKnowledgeWithdrawn(knowledgeIds[1], true);

    // A genuine intervening version makes reverting to the adopted version observable.
    const intermediateSpec = structuredClone(spec);
    intermediateSpec.nodes.find(node => node.name === "s20")!.dist!.args.mu = "500";
    const intermediateProposal = store.propose({ modelId: model.id, spec: intermediateSpec, summary: "検証用:巻き戻し前の中間版", knowledgeIds: [] });
    const intermediate = store.adopt(intermediateProposal.id);
    const reverted = store.revert(adopted.id);

    const unadoptedKnowledgeId = confirm("観測範囲外の高温側は別途測定して確かめたい", "s20");
    const pendingSpec = structuredClone(spec);
    pendingSpec.nodes.find(node => node.name === "s20")!.dist!.args.sigma = "80";
    const pendingProposal = store.propose({ modelId: model.id, spec: pendingSpec,
      summary: "検証用:確定知識はあるが未採用の変更", knowledgeIds: [unadoptedKnowledgeId] });
    return { exampleId: example.id, modelId: model.id, initialVersionId: initial.id,
      adoptedVersionId: adopted.id, intermediateVersionId: intermediate.id, currentRevertVersionId: reverted.id,
      adoptedProposalId: proposal.id, knowledgeIds, withdrawnKnowledgeId: knowledgeIds[1],
      unadoptedKnowledgeId, pendingProposalId: pendingProposal.id };
  });
  const reloaded = new Store(resolve(path));
  for (const example of examples) {
    assert.equal(reloaded.state.models.find(model => model.id === example.modelId)!.currentVersionId, example.currentRevertVersionId);
    assert.deepEqual(reloaded.version(example.currentRevertVersionId).origin, { kind: "revert", toVersionId: example.adoptedVersionId });
    const adopted = reloaded.version(example.adoptedVersionId);
    assert.deepEqual(adopted.origin, { kind: "proposal", proposalId: example.adoptedProposalId, knowledgeIds: example.knowledgeIds });
    assert.equal(reloaded.state.knowledge.find(k => k.id === example.withdrawnKnowledgeId)!.status, "withdrawn");
    assert.equal(reloaded.state.proposals.find(p => p.id === example.pendingProposalId)!.status, "proposed");
  }
  return { store: reloaded, examples };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = process.argv[2];
  if (!path) throw new Error("新規の検証ファイル名を指定してください。");
  const { examples } = seedAssumptionsDemo(path);
  console.log(JSON.stringify({ path: resolve(path), syntheticOnly: true, examples }, null, 2));
}
