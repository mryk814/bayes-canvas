# Model Evidence format

`bayes-canvas-evidence@2`は、Bayes Canvasから外部AI、notebook、PPL実装へ渡した仕様に対し、実際に行った検証を戻す形式です。モデル仕様そのものやImplementation Receiptとは役割を分けます。

```text
ModelDocument
  ├─ Implementation Receipt: どのentityをどこへ実装したか
  └─ Model Evidence: 何を実行し、何が観測され、何を直す根拠になったか
```

## Envelope

```json
{
  "evidenceVersion": "bayes-canvas-evidence@2",
  "specificationFingerprint": "sha256 fingerprint",
  "runType": "posterior_inference",
  "createdAt": "2026-10-07T00:00:00.000Z",
  "backend": "numpyro",
  "status": "review",
  "metrics": [
    {
      "id": "prior-range-y",
      "label": "Prior predictive y range",
      "value": "p01=-2.1, p99=2.4",
      "unit": "kg",
      "status": "pass",
      "entityIds": ["y"],
      "note": "10,000 draws"
    }
  ],
  "findings": [
    {
      "id": "tail-too-wide",
      "severity": "warning",
      "title": "Prior predictive tail is too wide",
      "detail": "The upper 1% exceeds the physically plausible range.",
      "entityIds": ["beta"],
      "suggestedPatch": [
        {
          "op": "replace",
          "path": "/entities/beta/distribution/args/sigma/source",
          "value": "0.5"
        }
      ]
    }
  ],
  "notes": [],
  "quantities": [
    {
      "entityId": "beta",
      "distribution": "posterior",
      "q05": 0.21,
      "q50": 0.48,
      "q95": 0.77,
      "draws": 4000
    }
  ],
  "assessment": {
    "elpdLoo": -212.4,
    "elpdLooSe": 9.1,
    "stackingWeight": 0.52,
    "divergences": 0,
    "maxRhat": 1.004,
    "minEssBulk": 950
  }
}
```

## Run types

- `prior_predictive`: priorと観測生成だけを実行した値域・tail確認
- `simulation_recovery`: 既知parameterから生成し、biasやcoverageを確認
- `prior_sensitivity`: priorや尤度scenario間でQoIの変化を比較
- `posterior_inference`: posterior inferenceを実行し、QoIの事後要約と予測性能・診断を返す（@2で追加）
- `posterior_predictive`: posterior inference後の再現性確認
- `calibration`: SBC、coverage、rankなどの較正確認

実行していない検証をrunTypeやmetricに含めません。目視レビューだけならEvidenceを捏造せず、通常のreview findingとして扱います。

## Quantities（@2）

`quantities`は、推定対象（QoI）の draws を要約した分位点です。draws そのものは運びません。

| field | 必須 | 意味 |
|-------|------|------|
| `entityId` | ○ | QoI の query entity、または parameter の entity ID |
| `distribution` | ○ | `prior` か `posterior`。posterior inference を実行していなければ `prior` |
| `q05`, `q50`, `q95` | ○ | 5%・50%・95% 分位点。`q05 ≤ q50 ≤ q95` |
| `q25`, `q75`, `mean`, `sd`, `draws` | | 追加の要約。計算したものだけ入れる |

query entity の式が記号1つ（`beta`）なら、その記号の結論として扱います。Model Score の結論の地図は、案ごとに最新の `posterior` 要約、なければ `prior` 要約、それもなければブラウザ内の prior 試算を表示します。事前の要約は「事後ではない」と明示し、事後と並べて比べません。

## Assessment（@2）

`assessment`は posterior inference の予測性能と計算診断です。計算した項目だけ入れます。

| field | 意味 |
|-------|------|
| `elpdLoo`, `elpdLooSe` | PSIS-LOO の elpd と標準誤差 |
| `stackingWeight` | 比較したモデル群での stacking weight（0〜1） |
| `divergences` | divergent transition の数（0以上の整数） |
| `maxRhat` | 最大 R-hat |
| `minEssBulk` | 最小 bulk ESS |

結論の地図では、`divergences > 0`、`maxRhat > 1.01`、`minEssBulk < 400` を診断の注意として表示します。assessment がない案は「未評価」として残し、捨てません。

## Fingerprint and patches

Evidenceは`specificationFingerprint`で対象revisionに結び付きます。不一致のEvidenceも履歴として保存できますが、その`SuggestedPatch`は現在のモデルへ適用できず、結論の地図でも結論・重みに数えません。Model Score は、表示した版の意味の指紋も記録しており、書き方だけが違う同じ確率モデルの Evidence も照合します（[`model-score.md`](./model-score.md) §8）。

`suggestedPatch`はRFC 6902形式です。Bayes Canvasはそのまま適用せず、対象document IDとrevision、許可されたpath、semantic diff、再compile後の診断を確認します。

## Version and migration

| version | 状態 | 違い |
|---------|------|------|
| `bayes-canvas-evidence@2` | 現行。検証protocolはこの形式を求める | `quantities`、`assessment`、runType `posterior_inference` を追加 |
| `bayes-canvas-evidence@1` | 読み込みのみ対応 | `quantities`・`assessment` を持たない。@1 に付いていても読まない |

- 保存済みの @1 Evidence は書き換えません。そのまま読み込み、metric・finding・支持レールに使います。結論の地図では「結論なし」として扱います。
- 保存先（`bayes-canvas:model-evidence`）と件数・容量の上限は変わりません。
- @2 を @1 として扱う旧版の Bayes Canvas では @2 を読み込めません。旧版へ渡す場合は `evidenceVersion` を @1 にし、`quantities`・`assessment`・`posterior_inference` を外してください。
