# 次セッションへの引き継ぎ: Model Space（結論の地図）

この文書は、新しいセッションがそのまま作業を始められるようにまとめた指示書。
最初にこの文書、[`docs/model-score.md`](./model-score.md)、`AGENTS.md` を読むこと。

## 0. 現在地

- ブランチ: `claude/model-lens-prototype`（main から2コミット、未push）
  - `d775843` Model Score（`#/score`）: 生成文の楽譜、4つの読み方、belief sparkline、支持レール、問いからの分岐、意味の差分、Evidence / Receipt 照合
  - `f2dd0f0` 事前の幾何: 漏斗検出、首の細さ、non-centered 座標、HMC の1歩、親との同時分布
- 既存UIは `#/` のまま動く。`app/src/main.tsx` が hash で2つの UI を出し分ける。
- 別セッションで「canvas 投影の軸二重化の修正」（`authoringSnapshot.ts` が shape 軸と plate 軸を別々に登録する問題）が進行中の可能性がある。着手前に `git log --all --oneline | head` で確認し、main に入っていれば rebase してから始める。
- 検証コマンド（すべて通る状態で引き継いでいる。テスト53件）:

```bash
npm run lint
npm run format:check
npm run test
npm run build
```

## 1. なぜ次に Model Space を作るのか

調査（2026年10月時点）からの結論:

- モデルを書く作業は LLM に置き換わりつつある（BoxLM、AutoStan、Large Language Bayes）。利用者自身も DAG を描かず AI に書かせている。
- ただし機械は意味と書き方を混同する。「Large Language Bayes Is Not Reparameterisation-Invariant」（arXiv 2610.00265）では、centered と non-centered という書き方の違いだけでモデル重みが 6.1〜31.9 倍ずれる。
- AutoStan は予測性能（NLPD）と診断だけを最適化し、推定対象・仮定・結論の頑健性を見ない。
- 人間の役割は「モデルの著者」から「モデル空間の統治者」へ移る。統治するのは次の3つ。
  1. **不変性**: どれが同じモデルか（書き方違いを同一視する）
  2. **問い**: どの推定対象（QoI）が大事か
  3. **結論の地図**: 候補群で結論が揃っているか、割れているなら、どの仮定が割っているか

Bayes Canvas は `ModelDocument` で確率的な意味と実装 hints を分けており、意味の差分（`meaningDiff`）も持っている。この層が上の3つの土台になる。

## 2. 作るもの（この順に、縦に通す）

### Step 1. 意味の fingerprint を分ける（小さく、土台）

**事実**: 現在の `specificationFingerprint` は `createStableFingerprint(document)` で、`revision`、label、notes、hints、authorship を含む文書全体の hash。そのため次の問題がある。

- Score の `patchDocument` は編集ごとに `revision` を上げるので、値を元に戻しても fingerprint が変わる。
- non-centered の hint を宣言しただけで別仕様になり、Evidence が「以前の仕様」扱いになる。

**やること**

- `app/src/lib/core/fingerprint.ts`（または新規 `semantic-fingerprint.ts`）に `semanticFingerprint(document)` を追加する。
  - 含める: axes（size, symbol）、plates（axisId, indexSymbol, parentPlateIds, assumption）、entities の確率的意味（kind, symbol, valueType, plateIds, distribution, expression, observedDataId, observationProcess, constraints, transform, queryRole, block の契約）
  - 除外する: `revision`, `documentId`, `model.name/description`, label, notes, tags, authorship, `hints`, `priorRationale`, `extensions`, LayoutDocument
  - 除外の理由をコメントで1行残す（「確率モデルが同じなら同じ指紋」）。
  - 生成された観測 binding（`obs_y` など、`authorship: 'generated'` のデータ）の id 揺れに注意。symbol と参照関係で正規化できるか確認する。
- **互換条件**: 既存の `specificationFingerprint`（handoff manifest、Evidence、Receipt の照合）は意味を変えない。portable format と Evidence format は変更しない。意味の指紋は「追加の照合キー」として使う。
- Score の Evidence 照合を2段にする: 実装指紋（現行）が一致すれば「この実装の検証」、意味の指紋だけ一致すれば「同じ確率モデルの検証（書き方は違う）」。支持レールの扱いは後者も `checked` にし、Grounds に区別を書く。Evidence 側に意味の指紋がない場合は、取り込み時の文書から計算して保存する（format は変えず、Score 側の保存領域に対応表を持つ）。
- モデル案の一覧で、意味の指紋が同じ案を「同じモデル（書き方違い）」として束ねて表示する。
- テスト: centered と non-centered（hint のみ違い）、revision 違い、label・rationale 違いで意味の指紋が一致すること。分布・scale・plate・観測過程を変えると一致しないこと。

### Step 2. Model Space（結論の地図）（本命）

目的: AI が書いた・問いから分岐した複数のモデルを1つの空間に置き、**結論を割っている仮定**を見えるようにする。

**データ**

- 点 = モデル案（既存の `bayes-canvas:model-variants`、`ModelVariant` 形式）。意味の指紋で重複を束ねる。
- 距離 = `meaningDiff` の種類別の差（prior / observation / hierarchy / index / estimand / assumption）。種類ごとに軸またはグループを作る。数値の埋め込みより、「どの種類の仮定が違うか」で群を作る方が説明可能。
- 結論 = 推定対象（QoI）の分布。
  - 事後分布の draws は外部から Evidence で戻る想定。`bayes-canvas-evidence@1` の metrics だけでは足りないので、**draws（QoI ごとの要約分位点で十分）を運ぶ拡張**が必要。Evidence format を変える場合は version を上げ、`docs/model-evidence-format.md` と移行を同時に更新する（AGENTS.md「移行は互換条件から設計する」）。先に利用者へ確認すること。
  - 事後分布がまだない案では prior predictive（`simulatePrior`）を表示し、「事後ではない」と明示する。
- 重み = 予測性能（LOO / stacking の重み）と計算診断（divergence、R-hat）。これも Evidence から来る。ない案は「未評価」として灰色にし、捨てない。

**画面**

- Score のヘッダー下の「案」の一列を、この空間に展開できるようにする（新しい独立ページを増やすより、既存の案の導線を広げる。AGENTS.md の IA 原則）。
- 中心に QoI の結論（例: `beta` の 90% 区間）を案ごとに縦に揃えて並べる（forest plot 型）。案の行は「どの種類の仮定が基準と違うか」で群にする。
- 結論が基準と食い違う案を強調し、その差を作っている `meaningDiff` の文を横に出す。「観測モデルを変えた群だけ beta の符号が反転」のように読めること。
- 案の点から Score の比較（A→B の変形）へ1クリックで入れる。
- 「AI に案を作らせる」導線: 現在のモデルと問いを渡し、N個の代替案（portable package / ModelDocument）を返させる prompt をコピーする。返答は既存の Import preview を通して案として一括取り込みする（既存データを直接上書きしない）。

**完成条件（AGENTS.md §9）**

- 案を3つ以上作る → 再読み込み → 地図に同じ配置で出る → 案を開いて比較 → 案を削除・Undo、までを実画面で通す。
- Evidence を貼ると、該当する案の結論と重みが更新される。fingerprint 不一致の Evidence は結論に数えない。
- `npm run test` に純粋関数（群分け、結論の食い違い判定、意味の指紋）のテストを足す。

### Step 3 以降（バックログ）

- **データ空間で信念を描く**: prior predictive の帯を直接つまんで「y はこの範囲」と描くと、prior の scale を逆算する（PreliZ の predictive elicitation、PriorWeaver の考え方）。
- **prior → posterior の変形**: posterior draws が戻ったら、power-scaling（priorsense）を1本のスライダーにして、漏斗の散布図や sparkline を prior から posterior へ変形させる。文ごとの「データから学んだ量」（事後と事前の幅の比）を支持レールに加える。
- **次に何を測るか**: 不確かさの源の説明（Variance Deltas）や期待情報利得で、どのデータを集めれば QoI の不確かさが減るかを示す。
- **識別可能性と反証可能性のトレードオフ**（arXiv 2307.14545）: モデルを拡張した案で、prior の締め付けが足りているかを問いとして出す。

## 3. 守ること

- 正本は `ModelDocument + LayoutDocument`。画面ごとの独自コピーを作らない。編集は JSON Patch → `compileModel` を通し、Undo できること。
- portable format、Evidence format、handoff の `specificationFingerprint` の意味を黙って変えない。変えるなら version と移行を用意し、先に利用者へ確認する。
- デザイン標準（`design-standard/`）に従う。burgundy は操作・重要だけ。散布図などのカテゴリ色は `chart-*`（紫系の `chart-5` を主役にしない）。色だけで区別しない。
- 説明文の洪水を避ける。行や点に出すのは短いラベル、理由は開いたときに出す。

## 4. 作業上の注意（このPC・この環境）

- Windows は大文字小文字を区別しない。`geometry.ts` と `Geometry.tsx` は衝突したので `GeometryView.tsx` にした。同名違いのファイルを作らない。
- `app/src/score/scoreModel.ts`、`priorSim.ts`、`geometry.ts` は node のテストからも読まれるため、import に `.js` 拡張子を付ける。テスト対象を増やしたら `app/tsconfig.test.json` の include に足す。
- dev server は `.claude/launch.json` の `app`（port 5175 固定）。Browser pane の viewport 指定は pane の幅変更で外れるので、撮影前に毎回 1440×900 を設定し直す。HMR で React state（比較中・選択中）が消えるので、確認操作は編集後にやり直す。
- 画面の状態は `bayes-canvas:score:document`、案は `bayes-canvas:model-variants`、Evidence は `bayes-canvas:model-evidence`（localStorage）。動作確認で入れた Evidence（backend `numpyro 0.15 (smoke test)`）と Receipt はテスト用データなので、利用者の実データと混同しない。

## 5. 参考文献

- Bayesian Workflow（Gelman, Vehtari ほか、書籍）
- Large Language Bayes（arXiv 2504.14025）、Large Language Bayes Is Not Reparameterisation-Invariant（arXiv 2610.00265）
- AutoStan（arXiv 2603.27766）、Automated Statistical Model Discovery with Language Models（arXiv 2402.17879）
- PreliZ（JOSS 2024）、Prior Knowledge Elicitation: The Past, Present, and Future（Bayesian Analysis 2024）、PriorWeaver（arXiv 2510.06550）
- Detecting and diagnosing prior and likelihood sensitivity with power-scaling（arXiv 2107.14054）
- Using stacking to average Bayesian predictive distributions（arXiv 1704.02030）、Iterative filtering for multiverse analysis（arXiv 2404.01688）
- Identifiability and Falsifiability（arXiv 2307.14545）、Variance Deltas（arXiv 2606.26309）、Modern Bayesian Experimental Design（arXiv 2302.14545）
- BayesFlow（arXiv 2306.16015）、sbi reloaded（arXiv 2411.17337）
