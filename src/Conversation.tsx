import { useState } from "react";
import { IconCopy, IconSend, IconTrash, IconX } from "@tabler/icons-react";
import { KIND_LABELS, type Candidate, type Intent, type Mark, type ModelSpec, type State } from "../shared/contracts.ts";
import { post, useAction } from "./api.ts";
import { ErrorNote, SideBySide, SpecDiff } from "./Ledger.tsx";
import { pad } from "./Stage.tsx";

export const ASK_PHRASE = "Possible Worlds に届いた意図を見て、候補を返してください";

export function markLabel(m: Mark, spec: ModelSpec | null) {
  const where = m.world === null ? "重ね表示" : `世界 ${pad(m.world)}`;
  if (m.kind === "verdict") return `${where} · ${m.verdict === "implausible" ? "あり得ない" : "あり得る"}`;
  if (m.kind === "sketch") return `${where} · なぞり線`;
  return `${where} · ${spec?.x.name ?? "x"} ${m.from}–${m.to}${spec?.x.unit ? ` ${spec.x.unit}` : ""}`;
}

type DraftProps = {
  spec: ModelSpec;
  marks: Mark[];
  utterance: string;
  onUtterance: (s: string) => void;
  onRemove: (i: number) => void;
  onClear: () => void;
  onSend: () => Promise<boolean>;
  busy: boolean;
  error: React.ComponentProps<typeof ErrorNote>["error"];
};

export function DraftTray(p: DraftProps) {
  return (
    <section className="draft" aria-label="Claude に渡すメモ">
      <h2>メモ</h2>
      {p.marks.length === 0 ? (
        <p className="empty-note">世界に「あり得ない／あり得る」を付けたり、なぞったり範囲を囲んだりすると、ここに集まります。</p>
      ) : (
        <ul className="chips">
          {p.marks.map((m, i) => (
            <li key={i} className={`chip chip-${m.kind}`}>
              {markLabel(m, p.spec)}
              <button className="chip-x" aria-label="このしるしを外す" onClick={() => p.onRemove(i)}>
                <IconX size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="field">
        <span>何が気になりますか</span>
        <textarea
          rows={3}
          value={p.utterance}
          placeholder="例：300°C で強度が上がる世界はあり得ない。高温ほど下がるはず"
          onChange={(e) => p.onUtterance(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && p.utterance.trim()) void p.onSend();
          }}
        />
      </label>
      <ErrorNote error={p.error} />
      <div className="row-actions">
        <button className="btn btn-primary" disabled={p.busy || !p.utterance.trim()} onClick={() => void p.onSend()}>
          <IconSend size={16} /> Claude に渡す
        </button>
        {(p.marks.length > 0 || p.utterance) && (
          <button className="btn btn-quiet" onClick={p.onClear}>
            <IconTrash size={16} /> 消す
          </button>
        )}
      </div>
    </section>
  );
}

export function IntentCard({ intent, state, agentConnected }: { intent: Intent; state: State; agentConnected: boolean }) {
  const { run, busy, error } = useAction();
  const [reply, setReply] = useState("");
  const version = state.versions.find((v) => v.id === intent.scene.modelVersionId) ?? null;
  const resolvedCandidate = intent.resolution ? intent.candidates.find((c) => c.id === intent.resolution!.candidateId) : null;
  const statusLabel = {
    pending: "Claude を待っています",
    answered: intent.candidates.length ? "候補が届きました" : "Claude から質問です",
    resolved: "確定",
    dismissed: "取り下げ",
  }[intent.status];

  return (
    <article className={`card intent status-${intent.status}`}>
      <header>
        <span className={`badge badge-${intent.status}`}>{statusLabel}</span>
        <span className="muted small">v{version?.number ?? "?"} · seed {intent.scene.seed}</span>
      </header>
      {intent.marks.length > 0 && (
        <ul className="chips">
          {intent.marks.map((m, i) => (
            <li key={i} className={`chip chip-${m.kind}`}>
              {markLabel(m, version?.spec ?? null)}
            </li>
          ))}
        </ul>
      )}
      <ol className="thread">
        {intent.thread.map((msg, i) => (
          <li key={i} className={`msg msg-${msg.from}`}>
            <span className="msg-from">{msg.from === "human" ? "あなた" : "Claude"}</span>
            <p>{msg.text}</p>
          </li>
        ))}
      </ol>

      {intent.status === "pending" && <WaitingHint agentConnected={agentConnected} />}

      {intent.status === "answered" && intent.candidates.length > 0 && (
        <div className="candidates">
          <p className="muted small">どの意味で受け取ればよいですか。選ぶと知識として残ります。</p>
          {intent.candidates.map((c) => (
            <CandidateCard
              key={c.id}
              candidate={c}
              base={state.versions.find((v) => v.id === state.currentVersionId)?.spec ?? null}
              seed={intent.scene.seed}
              busy={busy}
              onChoose={() => run(() => post(`/api/human/intents/${intent.id}/choose`, { candidateId: c.id }))}
            />
          ))}
        </div>
      )}

      {intent.status === "resolved" && resolvedCandidate && (
        <p className="resolved-note">
          <span className={`badge kind-${resolvedCandidate.kind}`}>{KIND_LABELS[resolvedCandidate.kind]}</span> {resolvedCandidate.statement}
          {intent.resolution?.proposalId && <span className="muted"> — 提案タブに変更案があります</span>}
        </p>
      )}

      {intent.status === "answered" && (
        <div className="follow-up">
          <label className="field">
            <span>{intent.candidates.length ? "どれも違う・補足する" : "答える"}</span>
            <textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} />
          </label>
          <button
            className="btn"
            disabled={busy || !reply.trim()}
            onClick={async () => {
              if (await run(() => post(`/api/human/intents/${intent.id}/follow-up`, { text: reply }))) setReply("");
            }}
          >
            <IconSend size={16} /> 返す
          </button>
        </div>
      )}
      <ErrorNote error={error} />
      {intent.status !== "resolved" && (
        <div className="row-actions end">
          <button
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => run(() => post(`/api/human/intents/${intent.id}/${intent.status === "dismissed" ? "restore" : "dismiss"}`))}
          >
            {intent.status === "dismissed" ? "戻す" : "取り下げる"}
          </button>
        </div>
      )}
    </article>
  );
}

function CandidateCard({ candidate, base, seed, busy, onChoose }: { candidate: Candidate; base: ModelSpec | null; seed: number; busy: boolean; onChoose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="candidate">
      <div className="candidate-head">
        <span className={`badge kind-${candidate.kind}`}>{KIND_LABELS[candidate.kind]}</span>
        <strong>{candidate.label}</strong>
      </div>
      <p>{candidate.statement}</p>
      {candidate.reasoning && <p className="muted small">{candidate.reasoning}</p>}
      {candidate.edit && (
        <div className="candidate-edit">
          <button className="btn btn-quiet" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "変更案を閉じる" : `変更案: ${candidate.edit.summary}`}
          </button>
          {open && (
            <>
              <SpecDiff before={base} after={candidate.edit.spec} />
              <SideBySide before={base} after={candidate.edit.spec} seed={seed} />
            </>
          )}
        </div>
      )}
      <button className="btn btn-choose" disabled={busy} onClick={onChoose}>
        これです
      </button>
    </div>
  );
}

export function WaitingHint({ agentConnected }: { agentConnected: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="waiting">
      <p>
        {agentConnected
          ? "Claude Code と接続しています。チャンネル付きで起動していれば自動で届きます。届かないときは次の一言を送ってください。"
          : "Claude Code にまだ接続していません。このフォルダで Claude Code を開き、次の一言を送ってください。"}
      </p>
      <div className="copy-line">
        <code>{ASK_PHRASE}</code>
        <button
          className="btn btn-quiet"
          onClick={() => {
            void navigator.clipboard.writeText(ASK_PHRASE).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          <IconCopy size={16} /> {copied ? "コピーしました" : "コピー"}
        </button>
      </div>
    </div>
  );
}
