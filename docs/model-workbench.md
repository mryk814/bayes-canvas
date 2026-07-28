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

「組む → 構造」のデータ契約欄は次のCSV headerを使います。

```csv
name,type,role,shape,unit,missing,levels
y,real,outcome,N,,possible,
x,real,predictor,N,kg,none,
group_id,category,index,N,,none,A|B|C
```

`role`は`outcome / predictor / index / coordinate / known_error / metadata`、`type`は`real / integer / boolean / category / positive`です。ここではDataノードと観測契約だけを作り、尤度やpriorを勝手に発明しません。

## モデル案を比較する

「確認 → モデル案」で現在の`ModelDocument + LayoutDocument`を名前付きで保存します。比較は画面のノード位置ではなく、entity、distribution、式、shapeなどのsemantic diffです。保存先はブラウザのlocalStorageで、最大20案です。

## 診断から直す

修正値を一意に提案できる診断は「診断から修正」に表示します。ボタンを押しても即時変更せず、patchをsandbox compileして診断数とsemantic diffを確認してから適用します。適用後は通常のUndoで戻せます。

## Prior predictiveを設計する

prior、likelihood、制約、shape、単位の確認項目を`ModelDocument`から生成します。「検証promptをコピー」は外部AIへモデル仕様を渡し、posterior fittingをせずprior predictiveだけを評価するよう求めます。

## 実装receiptを戻す

Handoff先はImplementation Receiptを返します。receiptを読み込むと、仕様fingerprintの一致、entity対応数、実装上の差分、追加仮定を確認できます。fingerprint不一致は、実装が現在表示中の仕様とは別revisionを対象にしていることを示します。
