import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react';
import { exportModelIr, generateAiPrompt } from './lib/modelIr';
import { initialEdges, initialNodes } from './samples/hierarchicalRegression';

export function App() {
  const nodes: Node[] = initialNodes;
  const edges: Edge[] = initialEdges;
  const modelIr = exportModelIr(nodes, edges);
  const prompt = generateAiPrompt(modelIr);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Bayes Canvas</h1>
          <p>Visual Bayesian modeling surface → strict model IR → AI/PPL implementation.</p>
        </div>
      </header>

      <section className="workspace">
        <aside className="panel left-panel">
          <h2>Palette</h2>
          <button>Data</button>
          <button>Parameter</button>
          <button>Deterministic</button>
          <button>Likelihood</button>
          <button>Plate</button>
        </aside>

        <section className="canvas">
          <ReactFlow nodes={nodes} edges={edges} fitView>
            <Background />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </section>

        <aside className="panel right-panel">
          <h2>Model IR</h2>
          <pre>{JSON.stringify(modelIr, null, 2)}</pre>
          <h2>AI Prompt</h2>
          <pre>{prompt}</pre>
        </aside>
      </section>
    </main>
  );
}
