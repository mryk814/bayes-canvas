import type { Dataset } from "../shared/contracts.ts";

export function DatasetPassport({ passport }: { passport: Dataset["passport"] }) {
  return <section className="dataset-passport" aria-label="観測のパスポート">
    <h4>観測のパスポート</h4>
    <dl>
      <dt>採取・対象の選び方</dt><dd>{passport?.sampling ?? "未記録"}</dd>
      <dt>装置・測定条件</dt><dd>{passport?.instrument ?? "未記録"}</dd>
      <dt>取り込み前の前処理</dt><dd>{passport?.preprocessing ?? "未記録"}</dd>
    </dl>
    <p className="small muted">提供者の申告です。内容の正しさを検証したものではありません。前処理は元CSVに至る処理で、アプリの単位換算・群対応の来歴とは別です。</p>
  </section>;
}
