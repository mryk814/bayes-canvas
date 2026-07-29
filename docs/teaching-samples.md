# Teaching samples

Bayes Canvas のサンプルは、完成モデルのコレクションではなく、モデルの書き方を一つずつ学ぶための教材です。
各 teaching sample は主な学習観点を二つまでに絞り、複数の論点をまとめて確認する大規模モデルは case study として分けます。

## カタログ

| Track | Sample | 主に見る観点 | Level |
|---|---|---|---|
| 基礎 | 階層回帰 | 部分プーリング、group index と階層事前分布 | 入門 |
| 基礎 | ロジスティック回帰 | Bernoulli 尤度と logit link、関心量 | 入門 |
| 基礎 | Poisson count モデル | Poisson 尤度と log link、exposure offset | 入門 |
| 観測過程 | 説明変数の測定誤差 | 観測値と潜在真値の分離、誤差スケール | 中級 |
| 観測過程 | 分母が不均一な Binomial 調査 | 行ごとの試行数、欠測方針と site 階層 | 中級 |
| 観測過程 | 打ち切りつき lab assay | 検出限界、希釈補正と batch 効果 | 中級 |
| 潜在構造 | 潜在クラス混合 | 有限混合、simplex と label switching | 発展 |
| 潜在構造 | 潜在軌跡の時系列 | random-walk 潜在状態、欠測と頑健尤度 | 発展 |
| 潜在構造 | 2パラメータ IRT | person-item の交差 index、潜在尺度の識別 | 発展 |
| 多変量・選択 | 可変 choice set | Categorical choice と候補 mask、回答者差 | 発展 |
| 多変量・選択 | 相関アウトカムパネル | event 軸、多変量尤度と LKJ Cholesky | 発展 |
| 非線形 | 小規模 BNN 回帰 | 明示的な隠れ層、重み事前分布による正則化 | 発展 |
| 統合例 | 階層 retail demand | 部品の統合、実装 handoff 前の論点棚卸し | 発展 |

## 整理の基準

- 同じ likelihood でも、link、offset、分母、mask など書き方の主眼が違えば別教材にする。
- 観測過程は基礎モデルへ混ぜず、測定誤差、打ち切り、欠測を明示できる例へ置く。
- 高度な例は「何を追加したか」だけでなく、識別、事前分布、backend handoff の確認質問を持つ。
- 大規模な統合例は入門例として扱わない。個々の部品を学んだ後に、接続関係を確認するために使う。
- 全サンプルは `review`、`pymc`、`numpyro`、`stan` target で blocking diagnostics がないことをテストする。

## 今回カタログへ増やさないもの

Gaussian process、survival、causal estimand、MNAR、Dirichlet-process mixture は契約として表現できますが、現時点では「小さく正しく教える」サンプルが未整備です。
見栄えだけの例は追加せず、識別条件、観測データ契約、handoff 時の注意まで一組にできた時点で教材へ加えます。
