import {
  StrictMode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/zen-kaku-gothic-new/400.css";
import "@fontsource/zen-kaku-gothic-new/700.css";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/jetbrains-mono";
import { JOINT_FIXTURES, queryJoint } from "./joint.ts";
import { CSV_EXAMPLES, previewCsv } from "./csv.ts";
import type { CsvMapping } from "./csv.ts";
import { bindCheck, runCheck, checkFixtures } from "./checks.ts";
import type { CheckDefinition, CheckResult } from "./checks.ts";
import "./style.css";

const percent = (value: number) => `${(value * 100).toFixed(0)}%`;
const number = (value: number) => Number(value.toFixed(2)).toString();
const ExportContext = createContext<(name: string, data: unknown) => void>(
  () => {},
);
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Joint() {
  const download = useContext(ExportContext);
  const [example, setExample] = useState(0);
  const fixture = JOINT_FIXTURES[example];
  const [thresholds, setThresholds] = useState(
    fixture.conditions.map((c) => String(c.threshold)),
  );
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [table, setTable] = useState(false);
  const [note, setNote] = useState("");
  const conditions = fixture.conditions.map((c, i) => ({
    ...c,
    threshold: thresholds[i].trim() === "" ? NaN : Number(thresholds[i]),
  }));
  const result = queryJoint(fixture.dataset, conditions);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % fixture.dataset.draws.length),
      1100,
    );
    return () => clearInterval(timer);
  }, [playing, fixture]);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  const draw = fixture.dataset.draws[index];
  const allValues = fixture.dataset.draws.flatMap((d) =>
    conditions.map((c) => d.values[c.variable]),
  );
  const max = Math.max(...allValues, 1) * 1.1;
  const y = (value: number) => 240 - (value / max) * 190;
  const matches = result.ok && result.matchedDrawIds.includes(draw.id);
  return (
    <>
      <div className="section-head">
        <div>
          <span className="eyebrow">P03 · U12 / JOINT QUERY</span>
          <h2>一緒に起きる、を確かめる。</h2>
          <p>二つの量を、同じ標本のまま動かします。</p>
        </div>
        <select
          aria-label="同時条件の例"
          value={example}
          onChange={(e) => {
            const n = Number(e.target.value);
            setExample(n);
            setThresholds(
              JOINT_FIXTURES[n].conditions.map((c) => String(c.threshold)),
            );
            setIndex(0);
            setPlaying(false);
            setNote("");
          }}
        >
          {JOINT_FIXTURES.map((f, i) => (
            <option value={i} key={f.id}>
              {f.title}
            </option>
          ))}
        </select>
      </div>
      <div className="split">
        <section className="paper stage">
          <div className="stage-top">
            <span className="badge">
              合成 {fixture.dataset.draws.length} 標本
            </span>
            <span className="mono">{draw.id}</span>
          </div>
          {!table ? (
            <svg
              viewBox="0 0 560 290"
              role="img"
              aria-label={`同じ標本 ${draw.id} の二つの量。${matches ? "両方成立" : "同時には成立しない"}`}
            >
              {[140, 420].map((x) => (
                <line key={x} x1={x} x2={x} y1="40" y2="245" className="axis" />
              ))}
              {fixture.dataset.draws.map((d) => (
                <line
                  key={d.id}
                  x1="140"
                  x2="420"
                  y1={y(d.values[conditions[0].variable])}
                  y2={y(d.values[conditions[1].variable])}
                  className={d.id === draw.id ? "thread active" : "thread"}
                />
              ))}
              {conditions.map((c, i) => (
                <g key={c.variable}>
                  <text x={i ? 420 : 140} y="22" textAnchor="middle">
                    {fixture.labels[c.variable]}
                  </text>
                  <circle
                    cx={i ? 420 : 140}
                    cy={y(draw.values[c.variable])}
                    r="9"
                    className="dot"
                  />
                  <text
                    x={i ? 455 : 105}
                    y={y(draw.values[c.variable]) + 5}
                    textAnchor={i ? "start" : "end"}
                    className="value"
                  >
                    {number(draw.values[c.variable])}
                  </text>
                  <text x={i ? 420 : 140} y="278" textAnchor="middle">
                    {fixture.units[c.variable]}
                  </text>
                </g>
              ))}
            </svg>
          ) : (
            <div className="table-wrap">
              <table>
                <caption>全標本・同じ行が同じ世界</caption>
                <thead>
                  <tr>
                    <th>標本</th>
                    {conditions.map((c) => (
                      <th key={c.variable}>{fixture.labels[c.variable]}</th>
                    ))}
                    <th>同時成立</th>
                  </tr>
                </thead>
                <tbody>
                  {fixture.dataset.draws.map((d) => (
                    <tr
                      key={d.id}
                      className={d.id === draw.id ? "selected-row" : ""}
                    >
                      <td>{d.id}</td>
                      {conditions.map((c) => (
                        <td key={c.variable}>
                          {d.values[c.variable]} {fixture.units[c.variable]}
                        </td>
                      ))}
                      <td>
                        {result.ok
                          ? result.matchedDrawIds.includes(d.id)
                            ? "✓ 成立"
                            : "− 不成立"
                          : "未計算"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="playback">
            <button onClick={() => setPlaying(!playing)}>
              {playing ? "停止" : "再生"}
            </button>
            <button
              onClick={() => {
                setPlaying(false);
                setIndex((index + 1) % fixture.dataset.draws.length);
              }}
            >
              一段進む
            </button>
            <label>
              標本 {index + 1} / {fixture.dataset.draws.length}
              <input
                aria-label="標本の位置"
                type="range"
                min="0"
                max={fixture.dataset.draws.length - 1}
                value={index}
                onChange={(e) => {
                  setPlaying(false);
                  setIndex(Number(e.target.value));
                }}
              />
            </label>
            <button
              aria-pressed={table}
              onClick={() => {
                setTable(!table);
                setPlaying(false);
              }}
            >
              {table ? "図に戻す" : "静止表"}
            </button>
          </div>
          <p className="caption">
            再生は標本の順送りです。現象の時間やMCMCの収束過程ではありません。すべての標本を同じ時間だけ表示します。
          </p>
        </section>
        <aside className="paper">
          <h3>この二つが、両方とも。</h3>
          {conditions.map((c, i) => (
            <label className="field" key={c.variable}>
              {fixture.labels[c.variable]} が
              <input
                type="number"
                aria-label={`${fixture.labels[c.variable]}の閾値`}
                value={thresholds[i]}
                onChange={(e) =>
                  setThresholds(
                    thresholds.map((v, j) => (i === j ? e.target.value : v)),
                  )
                }
              />
              {fixture.units[c.variable]} より大きい
            </label>
          ))}
          {result.ok ? (
            <div className="answer" aria-live="polite">
              <span>両方が成立する標本</span>
              <strong>
                {result.joint.count}
                <small> / {result.totalDraws}</small>
              </strong>
              <span>
                {percent(result.joint.probability)} · 全標本から直接集計
              </span>
              <div className="marginals">
                {result.marginals.map((m) => (
                  <p key={m.condition.variable}>
                    {fixture.labels[m.condition.variable]}だけなら{" "}
                    <b>{percent(m.probability)}</b>
                  </p>
                ))}
              </div>
            </div>
          ) : (
            <p role="alert" className="error">
              条件に数値を入れてください。
            </p>
          )}
          <p className="caption">
            周辺の割合を掛けても、同時に起きる割合にはなりません。小さな説明用標本であり、推論結果ではありません。
          </p>
        </aside>
      </div>
      <section className="paper note">
        <label htmlFor="joint-note">この組から、何を伝えたいですか。</label>
        <textarea
          id="joint-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例：この二つが同時に大きくなる状況もありそう"
        />
        <button
          disabled={!note.trim() || !result.ok}
          onClick={() =>
            download("joint-intent.json", {
              kind: "knowledge-expression",
              status: "uninterpreted",
              source: "synthetic-lab",
              modelRef: fixture.dataset.modelRef,
              runRef: fixture.dataset.runRef,
              drawId: draw.id,
              conditions,
              result,
              utterance: note,
            })
          }
        >
          意図をJSONに残す
        </button>
        <p className="caption">
          指した標本・条件・発言を保存します。モデルの変更やClaudeへの送信は行いません。
        </p>
      </section>
      <details>
        <summary>根拠と接続先</summary>
        <p className="mono">
          {fixture.dataset.modelRef}
          <br />
          {fixture.dataset.runRef}
        </p>
        <p>
          本体接続時にはrunのjoint
          drawを行単位で渡します。別々に再標本化しません。
        </p>
      </details>
    </>
  );
}

function Csv() {
  const download = useContext(ExportContext);
  const [text, setText] = useState(CSV_EXAMPLES[0].text);
  const [mapping, setMapping] = useState<CsvMapping>(CSV_EXAMPLES[0].mapping);
  const preview = previewCsv(text, mapping);
  const roles = [
    ["temperature", "温度"],
    ["strength", "強度"],
    ["group", "群"],
  ] as const;
  return (
    <>
      <div className="section-head">
        <div>
          <span className="eyebrow">P06 · U02 / DATA PASSPORT</span>
          <h2>あなたの列を、モデルの量へ。</h2>
          <p>列の意味と単位を決めて、取り込み前の姿を確かめます。</p>
        </div>
      </div>
      <div className="split">
        <section className="paper">
          <h3>1. CSVを用意する</h3>
          <div className="actions">
            {CSV_EXAMPLES.map((s, i) => (
              <button
                key={s.name}
                onClick={() => {
                  setText(s.text);
                  setMapping(s.mapping);
                }}
              >
                例 {i + 1}：{i ? "K / kPa" : "C / MPa"}
              </button>
            ))}
          </div>
          <label className="field">
            CSVの内容
            <textarea
              className="csv-input"
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <p className="caption">
            同梱例は合成データです。入力はこの画面内で処理し、サーバーへ送信しません。ラボは再読み込みで初期状態に戻ります。
          </p>
        </section>
        <section className="paper">
          <h3>2. 対応と単位を決める</h3>
          {roles.map(([key, label]) => (
            <div className="mapping" key={key}>
              <label>
                {label}の列
                <select
                  aria-label={`${label}の列`}
                  value={mapping.columns[key]}
                  onChange={(e) =>
                    setMapping({
                      ...mapping,
                      columns: { ...mapping.columns, [key]: e.target.value },
                    })
                  }
                >
                  <option value="">選んでください</option>
                  {preview.headers.map((h, i) => (
                    <option key={`${i}-${h}`} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
              {key !== "group" && (
                <label>
                  入力単位
                  <select
                    aria-label={`${label}の入力単位`}
                    value={mapping.units[key]}
                    onChange={(e) =>
                      setMapping({
                        ...mapping,
                        units: { ...mapping.units, [key]: e.target.value },
                      })
                    }
                  >
                    {(key === "temperature" ? ["C", "K"] : ["MPa", "kPa"]).map(
                      (u) => (
                        <option key={u}>{u}</option>
                      ),
                    )}
                  </select>
                </label>
              )}
            </div>
          ))}
          <p className="caption">
            変換先：温度 °C / 強度
            MPa。群は文字列のまま残します。列名から単位を推測しません。
          </p>
        </section>
      </div>
      <section className="paper">
        <div className="section-head">
          <h3>3. 候補を確かめる</h3>
          <button
            className="primary"
            disabled={!preview.canImport}
            onClick={() =>
              download("dataset-candidate.json", {
                kind: "dataset-candidate",
                status: "not-imported",
                ...preview,
              })
            }
          >
            候補JSONを書き出す
          </button>
        </div>
        <div aria-live="polite">
          {preview.issues.map((issue, i) => (
            <p
              className={issue.severity === "error" ? "error" : "warning"}
              key={i}
            >
              {issue.severity === "error" ? "要修正" : "確認"}
              {issue.row ? ` · レコード ${issue.row}` : ""}：{issue.message}
            </p>
          ))}
        </div>
        {preview.canImport ? (
          <div className="table-wrap">
            <table>
              <caption>
                {preview.rows.length} 行の変換結果 · 本体への登録前
              </caption>
              <thead>
                <tr>
                  <th>レコード</th>
                  <th>温度 °C</th>
                  <th>強度 MPa</th>
                  <th>群</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i}>
                    <td>{i + 2}</td>
                    <td>{String(row.temperature)}</td>
                    <td>{String(row.strength)}</td>
                    <td>{JSON.stringify(row.group)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            エラーを直すと全行のプレビューが出ます。正常な行だけの取り込みは行いません。
          </p>
        )}
      </section>
    </>
  );
}

function Checks() {
  const download = useContext(ExportContext);
  const [min, setMin] = useState("2");
  const [max, setMax] = useState("3");
  const [statistic, setStatistic] = useState<"mean" | "max">("mean");
  const [saved, setSaved] = useState<CheckDefinition | null>(null);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [error, setError] = useState("");
  const definition: CheckDefinition = {
    id: "lab-range-check",
    label: "群Aの区間検査",
    xMin: min.trim() === "" ? NaN : Number(min),
    xMax: max.trim() === "" ? NaN : Number(max),
    group: "A",
    statistic,
  };
  const dirty =
    saved !== null &&
    (saved.xMin !== definition.xMin ||
      saved.xMax !== definition.xMax ||
      saved.statistic !== statistic);
  const save = () => {
    try {
      const first = runCheck(
        bindCheck(definition, checkFixtures[0].context),
        checkFixtures[0],
      );
      setSaved({ ...definition });
      setResults([first]);
      setError("");
    } catch {
      setError(
        "区間の上下限と、区間内に観測があることを確認してください（例：2〜3）。",
      );
    }
  };
  const rerun = () => {
    if (!saved || dirty) return;
    try {
      const next = runCheck(
        bindCheck(saved, checkFixtures[1].context),
        checkFixtures[1],
      );
      setResults([...results.slice(0, 1), next]);
      setError("");
    } catch {
      setError("新版の証拠で計算できません。参照と区間を確認してください。");
    }
  };
  return (
    <>
      <div className="section-head">
        <div>
          <span className="eyebrow">U16 · RP24 / REPEATABLE CHECK</span>
          <h2>違和感を、次の版でも確かめる。</h2>
          <p>同じ区間・同じ計算で、観測とモデルの複製を比べます。</p>
        </div>
        <span className="badge">模式例 · 群A</span>
      </div>
      <div className="split">
        <section className="paper">
          <h3>どこを、どう確かめる？</h3>
          <div className="actions">
            <label className="field">
              x の下限
              <input
                type="number"
                value={min}
                onChange={(e) => setMin(e.target.value)}
              />
            </label>
            <label className="field">
              x の上限
              <input
                type="number"
                value={max}
                onChange={(e) => setMax(e.target.value)}
              />
            </label>
            <label className="field">
              比べる量
              <select
                value={statistic}
                onChange={(e) => setStatistic(e.target.value as "mean" | "max")}
              >
                <option value="mean">区間の平均</option>
                <option value="max">区間の最大値</option>
              </select>
            </label>
          </div>
          <p>
            両端を含む区間で、群Aの点を選びます。観測とすべての複製に同じ定義を使います。
          </p>
          <div className="actions">
            <button className="primary" onClick={save}>
              {saved ? "定義を保存し直してv1を検査" : "定義を保存してv1を検査"}
            </button>
            <button disabled={!saved || dirty} onClick={rerun}>
              同じ検査をv2で再実行
            </button>
          </div>
          {dirty && (
            <p className="warning">
              定義が変更されています。保存し直すと、この画面の比較結果を置き換えます。
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <p className="caption">
            ここでの保存は画面内のみ。定義と結果を残すにはJSONを書き出してください。
          </p>
        </section>
        <section className="paper">
          <h3>観測された点</h3>
          <div className="table-wrap">
            <table>
              <caption>合成データ · 任意単位</caption>
              <thead>
                <tr>
                  <th>x</th>
                  <th>y</th>
                  <th>群</th>
                </tr>
              </thead>
              <tbody>
                {checkFixtures[0].observed.map((p, i) => (
                  <tr key={i}>
                    <td>{p.x}</td>
                    <td>{number(p.y)}</td>
                    <td>{p.group}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section className="paper">
        <div className="section-head">
          <h3>版をまたいだ検査の記録</h3>
          <button
            disabled={!results.length}
            onClick={() =>
              download("saved-check.json", {
                kind: "exploratory-check",
                definition: saved,
                results,
              })
            }
          >
            定義と結果を書き出す
          </button>
        </div>
        {!results.length ? (
          <p className="empty">
            区間を選び、定義を保存すると最初の結果がここに残ります。
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <caption>
                保存した定義：x ∈ [{saved?.xMin}, {saved?.xMax}] · 群A ·{" "}
                {saved?.statistic === "mean" ? "平均" : "最大値"}
              </caption>
              <thead>
                <tr>
                  <th>モデル版 / run</th>
                  <th>観測値</th>
                  <th>複製の90%範囲</th>
                  <th>観測値以上の割合</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.context.modelVersionId}>
                    <td>
                      {r.context.modelVersionId}
                      <br />
                      <small>{r.context.runId}</small>
                    </td>
                    <td>
                      {number(r.observedValue)}
                      <br />
                      <small>{r.observedCount} 点</small>
                    </td>
                    <td>{r.predictiveRange.map(number).join(" 〜 ")}</td>
                    <td>
                      {percent(r.tailFraction)}
                      <br />
                      <small>{r.replicatedValues.length} 複製</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="caption">
          観測を見て選んだ探索的な検査です。割合は P(T複製 ≥
          T観測)。モデルが正しい確率や合否ではありません。検査を増やすと偶然の外れも増えます。
        </p>
      </section>
    </>
  );
}

function Lab() {
  const [tab, setTab] = useState("joint");
  return (
    <div className="shell">
      <header>
        <div className="brand">
          Possible Worlds <span>EXPERIENCE LAB</span>
        </div>
        <span className="badge">先行試作 · 本体から独立</span>
      </header>
      <div className="intro">
        <p className="eyebrow">見る → 指す → 意味を残す</p>
        <h1>次の問いを、試してみる。</h1>
        <p>
          モデルを育てるための、三つの小さな体験。
          <br />
          合成例から始め、数値と意図を持ち帰れます。
        </p>
      </div>
      <nav aria-label="先行体験">
        {[
          ["joint", "同時に起きる？", "共同標本"],
          ["csv", "自分のデータなら？", "列と単位"],
          ["checks", "次の版でも？", "保存する検査"],
        ].map(([id, title, subtitle]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <strong>{title}</strong>
            <span>{subtitle}</span>
          </button>
        ))}
      </nav>
      <main key={tab}>
        {tab === "joint" ? <Joint /> : tab === "csv" ? <Csv /> : <Checks />}
      </main>
      <footer>
        ラボ内の操作は本体のモデル・データを変更しません。画面を切り替えると入力と結果は初期化されます。残す場合はJSONを書き出してください。
      </footer>
    </div>
  );
}

function App() {
  const [output, setOutput] = useState<{ name: string; json: string } | null>(
    null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (output) dialog.current?.showModal();
  }, [output]);
  return (
    <ExportContext
      value={(name, data) =>
        setOutput({ name, json: JSON.stringify(data, null, 2) })
      }
    >
      <Lab />
      <dialog ref={dialog} onClose={() => setOutput(null)}>
        {output && (
          <>
            <div className="section-head">
              <h2>持ち帰る内容</h2>
              <button autoFocus onClick={() => dialog.current?.close()}>
                閉じる
              </button>
            </div>
            <p>{output.name} · 本体への登録前</p>
            <label className="field">
              JSON（選択してコピーできます）
              <textarea readOnly value={output.json} className="json-output" />
            </label>
            <button
              className="primary"
              onClick={() => download(output.name, JSON.parse(output.json))}
            >
              ファイルを保存
            </button>
            <p className="caption">
              保存が始まらないブラウザーでは、上のJSONを選択してコピーしてください。
            </p>
          </>
        )}
      </dialog>
    </ExportContext>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
