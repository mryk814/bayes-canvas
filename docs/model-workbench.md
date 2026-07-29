# Model workbench

Bayes Canvasの作業単位は、図を描くことではなく「モデル仕様を取り込み、仮定を比較し、診断し、実装との対応を確認する」一周です。

```text
外部AI / データ契約
  → Import preview
  → ModelDocument
  → モデル案比較
  → 診断・quick fix・Undo
  → prior predictive
  → Handoff
  → Implementation receipt
```

## 外部AIから取り込む

ヘッダーの「読み込み」から次のどちらかを選びます。

- **AI返答を貼る**: JSON単体、Markdownの`json` code fence、JSONの前後に説明がある返答を受け付けます。
- **ファイルを選ぶ**: portable package、raw `ModelDocument`、旧canvas JSONを読み込みます。

「AI用promptをコピー」には受理できる形式と契約が含まれています。Importは現在のモデルを即時上書きせず、ノード数、リンク数、診断、復元したリンクをpreviewします。適用時にはImport前のモデル案も自動保存します。

portable packageの正式な契約は[Handoff and portable format](./handoff-and-portable-format.md)を参照してください。

## データ契約から始める

「読み込み → データ」へCSV / TSVファイルまたは代表行を渡すと、型、role、欠測、category level、数値範囲を推定して編集可能なデータ契約を作ります。推定は先頭500行までで、outcomeを特定できない場合は明示的に確認を求めます。

「組む → 構造」のデータ契約欄は次のCSV headerを使います。

```csv
name,type,role,shape,unit,missing,levels
y,real,outcome,N,,possible,
x,real,predictor,N,kg,none,
group_id,category,index,N,,none,A|B|C
```

`role`は`outcome / predictor / index / coordinate / known_error / metadata`、`type`は`real / integer / boolean / category / positive`です。ここではDataノードと観測契約だけを作り、尤度やpriorを勝手に発明しません。

role、scalar type、unit、missing policyはDataノードの表示メモだけでなく、`ModelDocument`とportable round-tripにも保存されます。

## モデル案を比較する

「確認 → モデル案」で現在の`ModelDocument + LayoutDocument`を名前付きで保存します。比較は画面のノード位置ではなく、entity、distribution、式、shapeなどのsemantic diffです。保存先はブラウザのlocalStorageで、最大20案です。

## 診断から直す

修正値を一意に提案できる診断は「診断から修正」に表示します。ボタンを押しても即時変更せず、patchをsandbox compileして診断数とsemantic diffを確認してから適用します。適用後は通常のUndoで戻せます。

## Prior predictiveを設計する

prior、likelihood、制約、shape、単位の確認項目を`ModelDocument`から生成します。「検証promptをコピー」は外部AIへモデル仕様を渡し、posterior fittingをせずprior predictiveだけを評価するよう求めます。

## Model criticismと感度分析

Model ScoreはData binding、Prior intent、Identification、Estimand/QoI、Handoffの5面を別々に示します。単一scoreは入口であり、各面の不足理由を隠しません。

数値scaleを持つpriorには0.5倍・2倍、Normal観測にはStudent-tの感度scenarioを生成します。scenarioは即時適用せず、JSON Patchとしてsandbox compileした差分を確認してから適用し、Undoできます。

「検証protocolをコピー」はModelDocument、仕様fingerprint、感度scenario、Evidence返却schemaを外部AIやnotebookへ渡します。返ってきた`bayes-canvas-evidence@1`は貼り付けまたはJSONファイルで取り込みます。metric、finding、実行したbackendをfingerprintごとに保存し、findingの`suggestedPatch`も差分確認を通します。

Evidenceはブラウザへ新しい順に最大30件、全体約2MBを上限として保存します。容量を超える場合は古いrunから外れます。各runの`JSON`コピーを外部backupとして使えます。
取り込みと削除は画面上のUndoおよび`Ctrl+Z`、やり直しは`Ctrl+Shift+Z`で戻せます。

Evidenceの正式形式は[Model Evidence format](./model-evidence-format.md)を参照してください。

## Model Card

Model Cardはデータ契約、priorとその意図、観測モデル、QoI、診断、現在のEvidenceをMarkdownへまとめます。モデルそのものの正本にはせず、現在の`ModelDocument`から毎回生成します。

## 実装receiptを戻す

Handoff先はImplementation Receiptを返します。receiptを読み込むと、仕様fingerprintの一致、entity対応数、実装上の差分、追加仮定を確認できます。fingerprint不一致は、実装が現在表示中の仕様とは別revisionを対象にしていることを示します。
