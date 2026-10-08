# 実データの欠損・偏りと、試行錯誤を支える評価境界

## 1. 欠損・打切り・標本の偏りをどう扱うか

### Takeaway
欠損は「補完ボタン」で片づけず、観測された事実、観測されなかった理由についての仮定、その仮定を変えたときの結論を分ける。
まず既存の完全な数値配列を壊さない独立の試験場で、欠損の可視化と評価分母、群・時間の分割を扱うのが小さく有用な着手になる。

### Cited Findings
- Stan は欠損値を未知パラメータとして扱えるが、説明変数の欠損をモデル化せずパラメータにするだけでは不適切な事前分布になる。欠損した多変量応答の一部は観測部分の周辺分布を使って積分消去できる。説明変数の欠損と応答の欠損は同じ処理ではない。— [Stan: Missing Data](https://mc-stan.org/docs/stan-users-guide/missing-data.html)
- 欠損した応答の分布・平均は、追加仮定なしでは一般に点識別されない。感度パラメータを変える方法は、観測分布と両立する異なる欠損機構の下で推定がどう変わるかを調べる。観測確率が正であることなどの条件も必要になる。— [Cole et al.: Sensitivity Analyses for Means or Proportions with Missing Outcome Data](https://pmc.ncbi.nlm.nih.gov/articles/PMC10524136/)
- 打切りは値の一部だけが不明で、打ち切られた件数が分かる。切断では範囲外の測定が報告されない。右打切りは上限そのものの密度ではなく、上限を超える確率を尤度に寄与させられる。— [Stan: Truncated or Censored Data](https://mc-stan.org/docs/stan-users-guide/truncation-censoring.html)
- 事後層別化は標本とは別の母集団構成を使って集計し直す。群が小さい場合には階層モデルによる部分プーリングと組み合わせられる。— [Stan: Poststratification](https://mc-stan.org/docs/stan-users-guide/poststratification.html)
- 原本の確認時 HEAD は `ab6b6177c909c33910d5284e25fcd50dea9ecbb1`。`Dataset.columns` は `number[]`、CSV 空欄は有限数値エラーとなり、添付証拠の検査は形状・有限値・群添字が中心。パスポートは自由記述の sampling/instrument/preprocessing を保持する。観測ごとの欠損種別・検出限界・選択確率は構造化されていない。— [contracts.ts](C:/Users/ootan/projects/bayes-canvas/shared/contracts.ts:130)、[import-csv.ts](C:/Users/ootan/projects/bayes-canvas/shared/import-csv.ts:21)、[evidence-validation.ts](C:/Users/ootan/projects/bayes-canvas/shared/evidence-validation.ts:8)
- 現行 Stan 出力は `y >= cap - 1e-9` を右打切りと見なす。測定値がちょうど上限だったのか、丸められたのか、打切りフラグがあるのかを独立には表現できない。— [stan.ts](C:/Users/ootan/projects/bayes-canvas/shared/stan.ts:295)

### Inferences
- 自動表示できる事実は「列ごとの欠損数」「群・時期ごとの欠損率」「記録上限に一致する数」「標本内の群構成」。これらから MCAR/MAR/MNAR を自動判定しない。MAR/MNAR は観測データだけから一般に確定できる性質ではない。
- 最初の欠損ワークフローは、(1) 原値と欠損マスクを保持、(2) 完全ケースで見える範囲を表示、(3) MAR を仮定したモデル/多重補完、(4) 欠損値を条件付き予測から ±δ だけ移す感度シナリオ、(5) 主要な推定量・判断閾値がどこで変わるか表示、という流れがよい。δ は推定された真値ではなく、単位付きの仮定として見せる。
- 平均補完値を観測として保存すると、その後のエンジン切替で仮定と不確実性が消える。補完結果は派生物として原データ ID、方法、設定、seed、補完番号を持たせる。単一補完を使う瞬時プレビューは「仮埋めによる点予測」と明示する。
- 打切り、検出限界未満、測定せず、機器故障、対象外を一つの null に潰さない。最初から全種類を推論対応する必要はなく、未対応の種別は保持して、その計算法を不適用にする。
- 偏り補正は「重み付き」を選べば完了ではない。対象母集団、群構成の出典、選択に関係しそうな共変量、未観測層、極端な重みを見せる。重みの ESS は MCMC の ESS と別名・別意味で表示する。重みの切り詰めは感度シナリオとして記録する。
- 尤度を正規→Student-t に変える操作はモデル変更。周辺化や再パラメータ化は同じモデルを計算する変換。この二つを「高速化」の一語に混ぜない。

### Gaps
- 現場で実際に多い欠損理由、測定間隔、反復測定単位は未確認。実データの具体例を受け取るまでは分類体系を大きくしない。
- Claude の dirty 推論実装の評価設計は本担当では編集していない。ここでのコード観察は上記原本の確認時点に限る。
- 欠損割合のみから「この方法を使えばよい」という普遍的閾値は根拠を得ていない。

## 2. 対象に合う検証と、ベイズ以外の比較相手をどう置くか

### Takeaway
推論エンジンの数値的な正しさ、観測モデルの妥当性、新しい対象への予測力は別に測る。
比較相手には単純な平均・中央値、線形回帰、ロバスト回帰も置き、同じ対象・分割・指標で差を確かめる。

### Cited Findings
- GroupKFold は同じ群が訓練とテストの両方へ入らない分割に使える。時系列では通常のランダム分割が未来予測の評価を歪めるため、過去から未来への分割が必要となる。TimeSeriesSplit の行数単位の分割は、等間隔なら各 fold の期間を揃えやすい。— [scikit-learn: Cross-validation](https://scikit-learn.org/stable/modules/cross_validation.html)
- 標準化・補完・特徴選択は訓練部分だけで fit し、テスト部分にはその変換を適用する。全データで前処理してから分割すると漏洩になる。— [scikit-learn: Common pitfalls](https://scikit-learn.org/stable/common_pitfalls.html)
- 未来予測、既存時点で未観測だった値の予測、既存群内の新観測、未知の群への予測では、評価したい予測分布と適切な holdout が異なる。LOO は時系列で常に無効というわけではなく、条件付き観測モデルを評価する用途もある。— [loo: Cross-validation FAQ](https://mc-stan.org/loo/articles/online-only/faq.html)、[Bürkner, Gabry, Vehtari: Leave-future-out](https://arxiv.org/abs/1902.06281)
- Student-t 残差はロバスト回帰を表現する方法の一つ。— [Stan: Robust noise models](https://mc-stan.org/docs/stan-users-guide/regression.html#robust-noise-models)
- Huber 回帰は大きい残差の影響を小さくするが、観測を単に消す方法ではない。— [scikit-learn: Huber Regression](https://scikit-learn.org/stable/modules/linear_model.html#huber-regression)
- DummyRegressor は入力に依存しない平均・中央値・分位点などを予測する比較用モデルを提供する。— [scikit-learn: DummyRegressor](https://scikit-learn.org/stable/modules/generated/sklearn.dummy.DummyRegressor.html)

### Inferences
- 「次の患者/装置/ロット」「同じ装置の次回測定」「1週間先」「母集団全体の平均」を先に指定する。群を丸ごと抜くか、未来を抜くかはこの目的から決める。群と時間が共存する場合は両方の条件を満たす明示分割を使い、安易なランダム CV に戻さない。
- データが不規則間隔なら、行数の gap と時間の gap を混同しない。同時刻の観測は境界で分断しない。ラグ、移動平均、未来の測定から計算した特徴は元の値が使用可能になった時刻まで管理する必要がある。
- 欠損応答を評価時に除いたスコアは「観測されたテスト対象に対する成績」。母集団全体の成績へ自動昇格させない。対象総数、評価可能数、欠損・未予測・未対応による除外数を同じ画面で表示する。
- ベースラインの目的は「ベイズより劣る相手を置く」ことではない。単純な方法と結論が変わらなければ、速い方法で探索を続ける根拠になる。複雑なモデルだけ良くなる箇所は、群・時間・裾・欠損機構ごとの図で調べる。
- 点予測だけのモデルに架空の posterior draws を作らない。予測分布を持つものには log score/interval coverage、点予測には MAE/RMSE など、結果が実際に持つ能力を表示する。R² や平均誤差一つで普遍ランキングを作らない。
- 同じ validation データを見て試行錯誤を重ねた結果は探索用として履歴に残す。最後の持ち出し用コードでは、凍結した変換・対象・再学習条件と、別 holdout/外部検証の有無を添える。途中の高速近似を最終の計算法と同一にする必要はない。

### Gaps
- ユーザーが優先する推定量・誤差の費用は未確認。例えば外れ値への頑健性と裾の危険確率の推定は同じ目的ではない。
- BNN や特定の高度モデルが本アプリの小規模研究データで勝るという根拠はまだない。まず単純な比較と課題別検証を置く。

## 3. Claude の推論エンジンを助ける、今すぐ作れる試験場

### Takeaway
既存 Dataset/Run と dirty な推論コードを変えず、分割と評価対象の台帳を作る純粋関数を先に完成させる。
推論器の優劣を決める前に、同じデータを本当に同じ条件で比べていることを機械的に検査できる。

### Cited Findings
- 現行 Dataset は欠損を直接格納できず、Run は method/fidelity/draws と数値診断を保持する。行 ID、split、訓練で fit した変換との対応はこの契約にはない。— [contracts.ts](C:/Users/ootan/projects/bayes-canvas/shared/contracts.ts:136)
- train/test 分離と訓練内の前処理 fit は漏洩回避の基本境界になる。— [scikit-learn: Common pitfalls](https://scikit-learn.org/stable/common_pitfalls.html)

### Inferences
- 提案ファイルは `shared/research-split.ts` と対応テスト。既存 Dataset を受けて書き換えるのではなく、`rowId`、任意の group/time、nullable な評価用 value を持つ別入力で動く。戻り値は train/test/excluded の行 ID と理由、評価対象総数・観測数。nullable value は保持し、分割からこっそり消さない。
- 分割種別はまず明示行 ID、明示 holdout 群、時刻 cutoff の3つだけでよい。自動 K-fold、乱数 split、汎用ワークフロー基盤は不要。時刻や群 ID が分割に必要なのに欠けている場合は設定エラーにする。測定値の null は設定エラーではない。
- 受入テスト: 行 ID 重複・未知 ID・train/test 重複を拒否、群 split で群交差なし、time split で全 train < 全 test、同時刻境界を保つ、欠損値の行を保持、全応答欠損でも総数を返し metric は計算不能と明示、入力不変、並べ替え後も ID による対応が不変。
- 前処理 provenance は最低限 `fitRowIds` を受けて train の部分集合か検査する。これで「宣言された fit 範囲」は検査できるが、外部コードが実際にテストを読まなかったことまでは証明できない。関数名/メッセージもその限界を越えないものにする。
- テスト用データは6〜12行程度の手計算できる例にする。群 A/B、時刻1/2/3、1件の欠損、1件の上限値、同時刻2件を用意。別の評価マスクを差した際に分母が変わった事実を検出する。乱数シミュレーションの性能順位をスナップショットしない。
- 次の実験段階で合成の完全データを生成し、同じ完全データから MCAR/MAR/MNAR の欠損・右打切り・群の過少抽出を別々に導く。truth は合成専用と明示し、推論入力には渡さない。回復できたかだけでなく、仮定が間違ったときに何が変わるかを見せる。
- エンジン候補の適用判定には、このデータ契約を使う。欠損・打切り・重み・未知群がある候補に対し「対応」と「推論に入らず除外」を明確に区別する。速く完了しても、評価対象が減った結果は同一条件の更新として自動差し替えしない。

### Gaps
- これは独立 utility とテストの提案であり、既存アプリが nullable データで推論できるようになったという主張ではない。
- 研究用コード生成、最終再学習、欠損モデル、感度分析の実行器は次段階。まずこの小さい境界を完成させ、Claude 側の評価 artifact へ後で接続する。
- 調査後の実装状況: `shared/research-split.ts` の `splitResearchRows` と6件の境界テストを実装し、missing-module RED → 6件 GREEN、型検査成功を確認した。上記の前処理 `fitRowIds` 検査は実装していない。現状が返すのは分割・対象・欠損分母であり、前処理の適切さや統計的妥当性の認証ではない。
