# 途中の計算を使いながら考え、最後の成果物を確定する作業場

調査日: 2026-10-08。ここでの実装観測は読み取り時点の作業中ファイルであり、Claude ブランチの完成品評価ではない。

## 1. 速い途中結果と、最終的なモデル・コードはどう分けるか

### Takeaway

ユーザーが固定すべきものは「使うエンジン」より、問い・対象の量・データ・仮定である。
途中の近似、確定用の推論、描画用の計算を分けてもよいが、何の結果かを追跡できなければ、速さが考察を壊す。

### Cited Findings

- Bayesian Workflow は推論を単発の処理として扱わず、モデル構築・確認・計算上の問題の調査・理解・比較を繰り返すものと位置付ける。最終結論に使うモデルが途中に試すモデルすべてである必要はない。[Gelman et al., Bayesian Workflow](https://arxiv.org/abs/2011.01808)
- 可視化はモデル構築から評価・拡張までの各段階に役立つという、モデルを検討する作業全体の議論がある。[Gabry et al., Visualization in Bayesian workflow](https://arxiv.org/abs/1709.01449)
- Stan の standalone generated quantities は、既に得たパラメータ標本から新しい予測や派生量を別プログラムで計算できる。元の推論を毎回再実行する必要はない。ただしパラメータ定義との対応が前提である。[Stan User’s Guide 2.28](https://mc-stan.org/docs/2_28/stan-users-guide/stand-alone-generated-quantities-and-ongoing-prediction.html)
- Pathfinder は複数の近似経路と重要度再標本化を持ち、実行設定や個別経路の結果を記録できる。近似結果だけでなく、どの設定で得たものかを残せる。[CmdStan Pathfinder](https://mc-stan.org/docs/cmdstan-guide/pathfinder_config.html)
- Progressive visual analytics は粗い推定を早く出し、時間とともに改善する作業のための UI を研究している。ただしこの資料の全文取得はタイムアウトし、ここで依拠するのは著者提供要約の範囲である。[Badam et al., Steering the Craft](https://onlinelibrary.wiley.com/doi/10.1111/cgf.13205)

### Inferences

- 提案: 画面に現れる単位を「結果スナップショット」とする。最低限、モデル版、Dataset、前処理、計算コード／設定、用途、結果の生成時点を持つ。これは分散基盤や汎用 DAG の導入ではなく、現在の run の意味を明確にするための小さな参照契約でよい。
- 提案: 進捗と信頼状態を別軸にする。`待機・実行中・完了・中止・失敗` は仕事の状態、`未確認・検査で懸念・用途内で確認` は証拠の状態。「完了した」から「信用して表示する」へ自動昇格させない。
- 提案: 自動更新の停止は計算中止と分ける。人が図を固定して見ている間も計算は続け、新しい結果の到着を小さく知らせる。古い版の結果が遅れて届いても現行版へ上書きしない。
- 提案: 最終書き出しで固定するものは、選んだモデル版、データと前処理の同定情報、採用する実行コードと設定、使った検査結果、試行版からの意味上の差分。探索時の描画近似や一時的簡略化を最終コードへ無言で混ぜない。
- 提案: 作業中は「すぐ概形を見る」「この案をもう少し調べる」「この結果を記録する」の3段階程度にとどめる。秒数は保証せず、指定予算と実測を分ける。連続編集では未開始の旧ジョブをまとめ、実行中の旧計算を継続するか中止するかは明示したローカル方針で扱う。

### Gaps

- このアプリで、何秒の応答なら思考を妨げないかは未測定。架空の 1 秒・10 秒 SLA は設定しない。
- 異なる探索モデルと最終モデルの統計的同値性は一般に保証できない。「同値な再パラメータ化」「誤差をもつ近似」「別の仮定」の区別が必要。
- 汎用ジョブ管理、GPU スケジューラ、エンジンプラグイン市場は今回の研究 PC 用途に必要と判断する根拠がない。

## 2. 計算の検査、予測評価、採用意思、表示資格をどう分けるか

### Takeaway

「速くて予測スコアが良い」ことは、パラメータの事後分布が正しいことを意味しない。
計算の検査と用途別の評価を分け、人が採用しても足りない証拠を消さない契約が最優先である。

### Cited Findings

- SBC の感度は調べる量で変わり、従来型の一部検査は事後が事前のままという誤りさえ検出できない場合がある。論文はデータ依存の検査量、特に同時尤度を追加する意義を示す。[Modrák et al., SBC Checking](https://arxiv.org/abs/2211.02383)
- 時系列・同一個体・同一群の依存があるデータでは、通常のランダム分割が目的に合わない場合がある。scikit-learn は群を分離する分割と時系列分割を説明する。[Cross-validation](https://scikit-learn.org/stable/modules/cross_validation.html)
- 前処理を全データに適合してから評価用データを分けると情報漏洩になる。欠損補完や正規化等の適合は訓練側で行い、評価側にその変換を適用する必要がある。[Common pitfalls](https://scikit-learn.org/stable/common_pitfalls.html)
- ローカル観測: `Engine.tsx` の Prediction は CRPS、MAE、90% coverage、秒を表示する。AlgorithmCard は較正、NUTS との差、速度、予測を分けたカードを既に持つ。これは現在の Claude の取り組みを生かせる足場である。[Engine.tsx](C:/Users/ootan/projects/bayes-canvas-inference/src/Engine.tsx)
- ローカル観測: `evaluate.ts` の holdoutSplit は行をランダムに20%除く。predictiveScores は複数 observed ノードの件数・CRPS・MAE 等をまとめて平均する。評価単位・単位系・用途の適合を検証する契約は、この関数だけからは確認できない。[evaluate.ts](C:/Users/ootan/projects/bayes-canvas-inference/shared/evaluate.ts)
- ローカル観測: EngineReport の参照 NUTS は versionId を合わせるが Dataset では絞らない。AlgorithmCard の fit/cal は先頭の一致を読む。runShown は MCMC または採用済 algorithm の結果を許可し、approximationTrusted は Pareto k 欠損を許可する。読み取り時点の HEAD は `f0b0dc5d6b79f7f1c1cd1dd668f3bf0494d3614f` だが対象は未コミット変更を含む。[Engine.tsx](C:/Users/ootan/projects/bayes-canvas-inference/src/Engine.tsx)、[compare.ts](C:/Users/ootan/projects/bayes-canvas-inference/shared/compare.ts)

### Inferences

- 優先提案 P0: 比較前に `modelVersion + dataset + preprocessing + target + unit + split` を照合する小さな純関数。用途が「別モデル比較」の場合だけ modelVersion の違いを許可し、比較可能性と優劣の判定を分ける。
- 優先提案 P0: 計算検査の `pass / concern / unknown` と、人の `adopted / undecided / rejected` を別入力にする。欠損診断を正常に変換しない。採用意思は診断値を上書きしない。
- 優先提案 P0: `結果を読む` と `自動で主画面の結果として選ぶ` を分ける。懸念のある結果は比較・調査のため読めるが、自動昇格はしない。未確認結果を完全に隠すと調査できないため、表示禁止の単一 boolean で全用途を扱わない。
- 優先提案 P1: 予測評価は少なくとも量ごとに保持し、MPa と秒の CRPS を平均しない。将来まとめる場合は、事前に合意した無次元化や効用であることを明示する。
- 優先提案 P1: 一度きりの CRPS 比 1.05 を「同等」の統計的証拠にしない。対応した行ごとの差、評価件数、分割方法を見せる。固定 split を何度も見て案を選んだときは、そのセットを最終の独立評価とは呼ばない。
- 優先提案 P1: SBC は「この設定・検査量・反復数で目立つ異常を検出しなかった」と記す。SBC 成績だけで実データに対するモデル妥当性を証明しない。NUTS の比較対象も自分の診断が悪いと基準扱いしない。
- 今すぐ作れる非競合 testbed: 版違い、Dataset 違い、split 違い、単位違い、未知診断、失敗基準、採用済だが検査懸念、完了順逆転、点推定を事後標本として扱う誤りの fixture。Claude の server/API/UI は変更せず、新規 shared 純関数とテストから契約を渡す。

### Gaps

- Claude の作業は進行中なので、上記のローカル観測は修正済みになり得る。統合直前に差分を見る必要がある。
- server 側の全採用条件、実行コード、全保存 schema はこの担当では監査していない。UI の採用ボタンがあることだけで server に防御がないとは断定しない。
- 予測が良ければパラメータ解釈も安全、という一般的保証はない。反対にパラメータ近似が悪くても特定の予測が実用的な場合はあり、用途別に確認する必要がある。

## 3. ベイズ以外の計算を混ぜて、現実のデータの試行錯誤を助けるには

### Takeaway

ベイズ標本だけを統一形式にする必要はない。
集計・最適化・bootstrap・予測器を、何を推定し何の不確かさを表すかが分かる結果として共存させる方が、小さく実用的である。

### Cited Findings

- Stan の bootstrap の説明では、平均、最尤推定、罰則付き最尤推定、ベイズ点推定を、データから数値への推定量として扱う。bootstrap を通して推定量の変動を調べることができる。[Stan Bootstrap and Bagging](https://mc-stan.org/docs/stan-users-guide/bootstrap.html)
- 学習パイプラインを評価分割の中で適合することで、前処理と推定器を結合しながら評価側の情報漏洩を防げる。[scikit-learn Pipelines](https://sklearn.org/stable/modules/compose.html)
- 現行台帳は prior の比較、観測パスポート、保存検査、joint draw の道具を既に持つが、欠測・選択・検出下限、実データでの検証等は未実装または未確認としている。[台帳](C:/Users/ootan/projects/bayes-canvas-experience-lab/docs/research-ledger.md)

### Inferences

- 提案: 最初の非ベイズ候補は NN 全体の追加でなく、目的に即した頑丈な比較基準とする。例: 群別中央値、単純線形回帰、ロバスト回帰、bootstrap の予測区間。高度なベイズモデルがそれらと違う理由を確かめられる方が有益。
- 提案: 結果の種類を区別する。`posterior draws`、`approximate posterior draws`、`point estimate`、`bootstrap replicates`、`predictive samples` は同じ確率とは読まない。特に点推定を複製して ESS や事後確率の道具へ通さない。
- 提案: 二段階計算の中間点推定を固定するなら、後段がその推定誤差を含むかを表示する。例: 欠測補完した1つの表で全推論を行う結果と、補完の不確かさを伝播した結果を同じラベルにしない。
- 提案: 研究机上の一周は「元データと欠測・群・時間を確認 → 問いと対象量を固定 → 簡単な基準を見る → prior／観測過程の候補を見る → 安い計算 → 計算と予測の懸念を調べる → 気になる案を記録 → 選んだ案を詳しく計算」。途中で戻れることを優先する。
- 提案: 欠測処理・除外・重みづけ・対象群が変わったとき、同じモデル式でも結果の条件が変わる。数値の cache を再利用するより先に、該当結果の参照条件を変える。
- 提案: 初期デモは「外れ値 + 偏った群サイズ + 群を丸ごと外した評価」の一例がよい。教科書的 iid で綺麗な成功だけを見せず、ランダム行分割の成績と新しい群への成績が食い違う状況を残す。

### Gaps

- どの非ベイズ手法がこのアプリの実データに最適かは、実データや利用者の対象領域が未提供のため決められない。
- MAR/MNAR の判定や偏りの解消を自動保証する案ではない。データと専門知識に依存する仮定を比較可能にすることが目的。
- 汎用 NN フレームワーク、全エンジンを一括する型体系、任意コードの自動検証まで広げず、独立した一例と比較契約を先に検証する。
