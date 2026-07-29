# Model Evidence format

`bayes-canvas-evidence@1`は、Bayes Canvasから外部AI、notebook、PPL実装へ渡した仕様に対し、実際に行った検証を戻す形式です。モデル仕様そのものやImplementation Receiptとは役割を分けます。

```text
ModelDocument
  ├─ Implementation Receipt: どのentityをどこへ実装したか
  └─ Model Evidence: 何を実行し、何が観測され、何を直す根拠になったか
```

## Envelope

```json
{
  "evidenceVersion": "bayes-canvas-evidence@1",
  "specificationFingerprint": "sha256 fingerprint",
  "runType": "prior_predictive",
  "createdAt": "2026-07-29T00:00:00.000Z",
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
  "notes": []
}
```

## Run types

- `prior_predictive`: priorと観測生成だけを実行した値域・tail確認
- `simulation_recovery`: 既知parameterから生成し、biasやcoverageを確認
- `prior_sensitivity`: priorや尤度scenario間でQoIの変化を比較
- `posterior_predictive`: posterior inference後の再現性確認
- `calibration`: SBC、coverage、rankなどの較正確認

実行していない検証をrunTypeやmetricに含めません。目視レビューだけならEvidenceを捏造せず、通常のreview findingとして扱います。

## Fingerprint and patches

Evidenceは`specificationFingerprint`で対象revisionに結び付きます。不一致のEvidenceも履歴として保存できますが、その`SuggestedPatch`は現在のモデルへ適用できません。

`suggestedPatch`はRFC 6902形式です。Bayes Canvasはそのまま適用せず、対象document IDとrevision、許可されたpath、semantic diff、再compile後の診断を確認します。
