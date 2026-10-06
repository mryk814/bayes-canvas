# Model Score — radical prototype

`#/score` で起動する実験的ワークベンチ。既存UI（`/`）は変更せず、同じ正本と同じ保存領域を共有する。

## 1. 正本と投影

| 区分 | 何か | Score での扱い |
|------|------|----------------|
| 正本 | `ModelDocument` | 唯一の編集対象。変更はすべて JSON Patch → `applyJsonPatch` → `compileModel` を通す |
| 正本 | `LayoutDocument` | Score は座標を使わないが、破棄せず保持し、モデル案・portable round-trip にそのまま渡す |
| 派生 | `SemanticModel`（compile結果） | 依存辺・診断・readiness。毎回 `ModelDocument` から計算 |
| 派生 | 生成順・stage・plate帯・Story文・数式・shape | `src/score/scoreModel.ts` の純粋関数で計算し、保存しない |
| 派生 | 認識の確からしさ（support grade） | priorRationale・診断・Evidence・receipt から計算 |
| 外部記録 | モデル案 `bayes-canvas:model-variants` | 既存UIと同じキー・同じ `ModelVariant` 形式 |
| 外部記録 | Evidence `bayes-canvas:model-evidence` | 既存UIと同じキー。`specificationFingerprint` で現行仕様に結び付ける |
| 外部記録 | Implementation Receipt | 読み込み時に fingerprint を照合。保存はしない（セッション内） |

既存UIでは React Flow の nodes/edges が実質の編集状態で、そこから `ModelDocument` を毎回組み立てている。
Score は逆に `ModelDocument` を直接 state として持ち、画面はすべてその投影として描く。

## 2. 人はベイズモデルを何として理解しているか

DAG ではなく、**「世界がデータをどう生んだか」についての主張の列**として理解している。
1行の `alpha[j] ~ Normal(alpha_bar, tau_alpha)` は同時に

- 数式（そのまま式）
- 生成の一段（Story：「各グループの切片はグローバル平均のまわりにばらつく」）
- 依存（右辺が参照する記号）
- 反復の範囲（`j` 上で反復 = plate）
- 信念（prior の形と、その根拠）
- 主張としての確からしさ（根拠・検証・反証の有無）

を持つ。グラフは「主張どうしの参照関係」を抜き出した二次的な図である。
したがって Score では **1つの生成文（statement）を基本単位**にし、数式・Story・shape・Evidence をその行の「顔」として切り替える。

## 3. 3案の比較

### A. Model Space（意味論的ズーム）
2D空間にモデルを置き、ズームで story → 構造 → 数式 → 詳細へ潜る。

- 長所: 空間記憶。全体像から詳細への連続性。
- 弱点: ズーム操作が重く、数式を読むには常に深く潜る必要がある。2案の位置合わせが難しく比較に弱い。
- 破綻: 50変数以上・多重plateで、どのズーム段でも情報が混む。
- 初学者 ◎ / 専門家 △（式を読む往復が遅い）

### B. Generative Score（生成の楽譜）— 採用
モデルを生成順に並んだ文の列として縦に置く。楽譜の staff のように

- 左の **依存ガター** に参照の配線
- **plate 帯** が反復範囲を括弧のように括る（`j ∈ 1..J`）
- 中央の **文** が式・Story・shape・実装の4つの読み方に変形する
- 右の **支持レール** が主張の確からしさを線種で示す

行を選ぶとその場で開き（inspect-in-place）、prior の形、shape、問い、Evidence、実装対応が同じ行の下に並ぶ。

- 長所: 数式と構造が分離しない（行そのものが式）。縦に伸びるだけなので大規模でも破綻しにくく、plate は折りたためる。2案を行単位で揃えられるので比較が自然。Evidence を行に結び付けやすい。
- 弱点: 複雑な DAG では配線が交差する。2D の自由配置による「描きながら考える」は失う。
- 破綻: 循環的に読みたい構造（状態空間の時間方向）や、block の内部構造が深いモデル。→ block は1行として扱い、内部は展開行で扱う。
- 初学者 ○（上から読めば生成過程） / 専門家 ◎（式を直接読む・比較が速い）

### C. Semantic Lens（正準DAG＋レンズ）
1枚の DAG の上に dependency / equation / data / assumption / evidence レンズを重ねる。

- 長所: 1枚の絵のまま観点を変えられる。
- 弱点: 結局ノードグラフが主役。数式を図に重ねると読めない。レンズを重ねるほど情報過多。
- 破綻: ノード数が増えた時点で、レンズ以前に図が読めない。
- 初学者 ○ / 専門家 △

### 選択理由
B は「式・構造・仮定・Story・Evidence を同じ行の顔にする」ことを最も直接に実現する。
A の連続的な見方の変化は「読み方の切替を行ごとの変形アニメーション」として、C のレンズは「支持レール・ガターの強調」として取り込む。

## 4. 主要な操作

| 操作 | 何が起きるか |
|------|--------------|
| 行を選ぶ | 上流（この行が依存するもの）・下流（この行に依存するもの）がガターで強調され、行がその場で開く |
| 式中の記号に触れる | 参照先の行が同時に強調される（brushing）。クリックでその行へ焦点移動 |
| 読み方を変える（式 / Story / Shape / 実装） | 全行がその場で変形する。ページ遷移はしない |
| prior の scale をドラッグ | JSON Patch を作り、sandbox compile と prior predictive をその場で更新。確定まで正本は変わらない |
| 問いから代替案を作る | 「裾は十分か？」→ Student-t 案。現行を案Aとして保存し、案Bへ移ってから意味の差分を表示 |
| 比較 | 行を揃えて A→B の変形をスクラブで再生。差分は「priorが2倍広くなった」「観測の裾が厚くなった」のように意味で要約 |
| Evidence / Receipt を読み込む | fingerprint で照合し、metric・finding・mapping が該当行の支持レールに付く |

## 5. 不確かさの表現

支持レールは線種で段階を表し、必ず文字ラベルを併記する（色や透明度だけに頼らない）。

| grade | 意味 | 線 |
|-------|------|----|
| `stated` | 書いただけ（根拠なし） | 点線 |
| `reasoned` | prior intent / rationale あり | 破線 |
| `checked` | 現行 fingerprint の Evidence が pass | 実線 |
| `contested` | 診断 warning/error、Evidence が review/fail | 途切れた線＋警告色 |
| data | 観測された事実 | 太い実線 |

実装 receipt の有無は別の印（`impl`）として同じレールに付く。

## 6. 事前の幾何

計算が壊れる場所は、ほとんどが分布の形で説明できる。Score は prior の前向き抽出から、draw ごとに揃えた同時サンプル（`PriorSimulation.joint`）を取り、行を開いたときに形として見せる。

- **漏斗（funnel）**: plate を持つ潜在変数の scale 引数が確率変数を直接参照しているとき（`alpha[j] ~ Normal(alpha_bar, tau_alpha)`）、`(log tau, alpha_j − alpha_bar)` は首の細い漏斗になる。首の細さは scale 上位10% と下位10% での幅の比で、行には `漏斗 ×N` と出す（N > 8）。
- **1歩の幅**: scale が大きい所に合わせた1歩を、小さい所にも同じ長さで描く。centered では首の壁を越え、non-centered 座標 `z = (alpha_j − alpha_bar) / tau` では同じ1歩がどこでも収まる。HMC の step size が合わない理由を、そのまま図にしている。
- **宣言**: 「右の座標で実装すると宣言する」は `hints: parameterization = non_centered` を追加する JSON Patch で、確率モデルは変えない。意味の差分では「実装方針」として表示される。
- **依存の形**: 漏斗以外の行では、確率的な親との同時分布を散布図と ±2sd 帯で示す。相関がゼロでも幅が変われば独立ではない。

いずれも事前分布の形で、事後分布ではない。グループあたりのデータが少ないほど、事後分布はこの形を引き継ぐ。

## 7. 既知の制限

- prior predictive はブラウザ内で Normal / HalfNormal / StudentT / Exponential / HalfCauchy / LogNormal / Cauchy / Uniform / Beta / Gamma の単変量のみ抽出する。対応外の分布を含む場合はその旨を表示し、外部検証 prompt に誘導する。
- `x` の probe 値は「標準化済み predictor の -2..2」と仮定して表示する（データ契約から範囲を取れる場合はそれを使う）。
- 編集できるのは prior の数値引数・観測分布の置換・問い由来の patch のみ。エンティティ追加は既存UIを使う。
- Score 自身の作業状態は `bayes-canvas:score:document` に保存する。既存UIの canvas 状態とは同期しない（モデル案・Evidence は共有）。
- 案の系譜は保存順の一列で、分岐の親子関係は保存していない。
- サンプルの canvas 投影では、shape で宣言した軸（`J`, `N`）と plate 由来の軸（`GROUP`, `OBS`）が別々に登録される。Score はこれを「軸の二重化」として検出し、統合 patch を提案する。

## ファイル

| ファイル | 責任 |
|----------|------|
| `app/src/score/scoreModel.ts` | 生成順・stage・数式・物語・shape・support grade・問い・意味の差分（純粋関数、テストあり） |
| `app/src/score/geometry.ts` | 漏斗の検出、首の細さ、non-centered 座標、親との同時分布（純粋関数、テストあり） |
| `app/src/score/GeometryView.tsx` | 散布図・±2sd 帯・1歩の幅・宣言操作 |
| `app/src/score/priorSim.ts` | `ModelDocument` からの prior 前向き抽出、KDE、区間幅の変化（純粋関数、テストあり） |
| `app/src/score/useScoreDocument.ts` | 正本 state、JSON Patch 適用、Undo/Redo、保存 |
| `app/src/score/Sheet.tsx` | 楽譜本体：依存ガター、plate 括弧、4つの読み方、支持レール |
| `app/src/score/Dossier.tsx` | 行をその場で開いたときの信念・つながり・問い・根拠 |
| `app/src/score/ScoreApp.tsx` | 問い・案・比較・Ledger・読み込み |

## 検証

```bash
npm run test
npm run build
```

`app/test/score.test.mjs` が生成順、軸統合 patch の compile、意味の差分、prior 抽出の決定性と下流への波及を確認する。
