import React, { useEffect, useMemo, useState } from "react";

type PolicyValue = { valuePath: string; valueType: "TEXT" | "INTEGER" | "DECIMAL" | "BOOLEAN" | "NULL"; textValue: string | null; integerValue: string | null; decimalValue: string | null; booleanValue: boolean | null };
type PolicyRevision = { revisionId: string; revisionNumber: number; status: "UNREVIEWED" | "APPROVED" | "REJECTED" | "SUPERSEDED"; contentSha256: string; provenanceRef: string; effectiveFromYear: number | null; effectiveToYear: number | null; createdBy: string; priorRevisionId: string | null; values: PolicyValue[] };
type LockedOwnerAuthorityView = { authorityId: string; domain: string; statement: string };
type ReviewSection = "PENDING_SEMANTIC_AUTHORITY" | "PENDING_NUMERIC_AUTHORITY" | "APPROVED_POLICY_REVISION" | "REJECTED_OR_SUPERSEDED";
export type OwnerPolicyDefinitionView = { policyId: string; title: string; domain: string; description: string; unit: string | null; reviewAuthority: "SEMANTIC" | "NUMERIC"; lifecycleKind: "GENESIS" | "SCHEDULED_BARRIER" | "ATOMIC_YEAR_BARRIER"; defaultEffectiveYear: number | null; reviewSection: ReviewSection; lockedOwnerAuthorities: LockedOwnerAuthorityView[]; consumerLinks: { consumerId: string; causal: boolean }[]; revisions: PolicyRevision[] };

function valueText(value: PolicyValue): string {
  return value.valueType === "TEXT" ? value.textValue ?? "" : value.valueType === "INTEGER" ? value.integerValue ?? "" : value.valueType === "DECIMAL" ? value.decimalValue ?? "" : value.valueType === "BOOLEAN" ? String(value.booleanValue) : "";
}

const SECTION_LABEL: Record<ReviewSection, string> = {
  PENDING_SEMANTIC_AUTHORITY: "PENDING SEMANTIC AUTHORITY",
  PENDING_NUMERIC_AUTHORITY: "PENDING NUMERIC AUTHORITY",
  APPROVED_POLICY_REVISION: "APPROVED POLICY REVISION",
  REJECTED_OR_SUPERSEDED: "REJECTED / SUPERSEDED",
};

export function OwnerPolicyCenter({ definitions, busy, onDecide, onCreateRevision }: {
  definitions: OwnerPolicyDefinitionView[];
  busy: boolean;
  onDecide: (input: { revisionIds: string[]; action: "APPROVE" | "REJECT" | "RESET" | "SUPERSEDE"; reason?: string; effectiveFromYearOverride?: number }) => Promise<void>;
  onCreateRevision: (input: { policyId: string; values: PolicyValue[] }) => Promise<void>;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<ReviewSection | "ALL">("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bulkRevisionIds, setBulkRevisionIds] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [overrideBoundary, setOverrideBoundary] = useState(false);
  const [effectiveFromYearOverride, setEffectiveFromYearOverride] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const visible = useMemo(() => definitions.filter((definition) => (section === "ALL" || definition.reviewSection === section) && `${definition.policyId} ${definition.title} ${definition.domain} ${definition.description} ${definition.consumerLinks.map((consumer) => consumer.consumerId).join(" ")}`.toLowerCase().includes(query.toLowerCase())), [definitions, query, section]);
  const selected = visible.find((definition) => definition.policyId === selectedId) ?? visible[0] ?? null;
  const revision = selected?.revisions[0] ?? null;
  useEffect(() => { setBulkRevisionIds((prior) => new Set([...prior].filter((revisionId) => definitions.some((definition) => definition.revisions[0]?.revisionId === revisionId && definition.revisions[0].status === "UNREVIEWED")))); }, [definitions]);

  const beginEdit = (): void => {
    if (!revision) return;
    setDraft(Object.fromEntries(revision.values.map((value) => [value.valuePath, valueText(value)])));
    setEditing(true);
  };
  const saveEdit = async (): Promise<void> => {
    if (!selected || !revision) return;
    const values = revision.values.map((value) => ({ ...value, textValue: value.valueType === "TEXT" ? draft[value.valuePath] ?? "" : null, integerValue: value.valueType === "INTEGER" ? draft[value.valuePath] ?? "0" : null, decimalValue: value.valueType === "DECIMAL" ? draft[value.valuePath] ?? "0" : null, booleanValue: value.valueType === "BOOLEAN" ? draft[value.valuePath] === "true" : null }));
    await onCreateRevision({ policyId: selected.policyId, values });
    setEditing(false);
  };
  const decide = async (action: "APPROVE" | "REJECT" | "RESET" | "SUPERSEDE", revisionIds: string[]): Promise<void> => {
    await onDecide({ revisionIds, action, reason: reason.trim() || undefined, effectiveFromYearOverride: action === "APPROVE" && overrideBoundary ? effectiveFromYearOverride : undefined });
    setBulkRevisionIds(new Set());
  };
  const toggleBulk = (revisionId: string): void => setBulkRevisionIds((prior) => { const next = new Set(prior); if (next.has(revisionId)) next.delete(revisionId); else next.add(revisionId); return next; });

  return <>
    <div className="toolbar">
      <label>SEARCH POLICIES<input aria-label="Search Owner Policies" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
      <label>REVIEW STATE<select aria-label="Owner Policy review state" value={section} onChange={(event) => setSection(event.target.value as ReviewSection | "ALL")}><option value="ALL">ALL</option>{Object.entries(SECTION_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><input aria-label="Override default effective year" type="checkbox" checked={overrideBoundary} onChange={(event) => setOverrideBoundary(event.target.checked)}/> OVERRIDE DEFAULT EFFECTIVE YEAR</label>
      {overrideBoundary && <label>EFFECTIVE YEAR OVERRIDE<input aria-label="Policy effective year override" type="number" min="0" value={effectiveFromYearOverride} onChange={(event) => setEffectiveFromYearOverride(Math.max(0, Number(event.target.value) || 0))}/></label>}
    </div>
    <div className="master-detail">
      <section className="entity-list" aria-label="Owner Policy definitions">{visible.map((definition) => {
        const candidate = definition.revisions[0];
        const selectable = candidate?.status === "UNREVIEWED";
        return <div className={selected?.policyId === definition.policyId ? "active policy-list-row" : "policy-list-row"} key={definition.policyId}>
          <label className="policy-bulk-select"><input type="checkbox" aria-label={`Select ${definition.policyId} for bulk decision`} disabled={!selectable || busy} checked={Boolean(candidate && bulkRevisionIds.has(candidate.revisionId))} onChange={() => candidate && toggleBulk(candidate.revisionId)}/></label>
          <button onClick={() => { setSelectedId(definition.policyId); setEditing(false); }}><strong>{definition.title}</strong><span>{definition.policyId}</span><small>{SECTION_LABEL[definition.reviewSection]} · {definition.consumerLinks.length} causal consumers</small></button>
        </div>;
      })}</section>
      <section className="detail entity-detail"><p className="eyebrow">OWNER POLICY CENTER</p><h2>{selected?.title ?? "No policy definitions"}</h2>{selected && <>
        <p>{selected.description}</p>
        <dl><div><dt>Policy ID</dt><dd>{selected.policyId}</dd></div><div><dt>Review authority</dt><dd>{SECTION_LABEL[selected.reviewSection]}</dd></div><div><dt>Units</dt><dd>{selected.unit ?? "Semantic / typed"}</dd></div><div><dt>Consumers</dt><dd>{selected.consumerLinks.map((consumer) => consumer.consumerId).join(" · ") || "None"}</dd></div><div><dt>Status</dt><dd>{revision?.status ?? "NO REVISION"}</dd></div><div><dt>Canonical content hash</dt><dd>{revision?.contentSha256 ?? "—"} <small>(generated automatically)</small></dd></div><div><dt>Effective boundary</dt><dd>{revision?.effectiveFromYear !== null && revision?.effectiveFromYear !== undefined ? `${revision.effectiveFromYear}–${revision.effectiveToYear ?? "open"}` : selected.lifecycleKind === "GENESIS" ? "Default: year 0 / next new run" : selected.lifecycleKind === "SCHEDULED_BARRIER" ? `Default: designed barrier year ${selected.defaultEffectiveYear}` : "Default: next atomic-year barrier"}</dd></div><div><dt>Approval metadata</dt><dd>Owner/session, timestamp, revision, prior revision, hash, and action provenance are recorded automatically.</dd></div></dl>
        {selected.lockedOwnerAuthorities.length > 0 && <section aria-label="Locked Owner Structure"><h3>LOCKED OWNER STRUCTURE</h3>{selected.lockedOwnerAuthorities.map((authority) => <article key={authority.authorityId}><strong>{authority.authorityId}</strong><p>{authority.statement}</p></article>)}</section>}
        {revision && <section><h3>{selected.reviewAuthority === "SEMANTIC" ? "PENDING SEMANTIC AUTHORITY" : "PENDING NUMERIC AUTHORITY"}</h3><dl>{revision.values.map((value) => <div key={value.valuePath}><dt>{value.valuePath}</dt><dd>{editing && value.valueType !== "NULL" ? value.valueType === "BOOLEAN" ? <select value={draft[value.valuePath] ?? "false"} onChange={(event) => setDraft((prior) => ({ ...prior, [value.valuePath]: event.target.value }))}><option>true</option><option>false</option></select> : <input value={draft[value.valuePath] ?? ""} onChange={(event) => setDraft((prior) => ({ ...prior, [value.valuePath]: event.target.value }))}/> : valueText(value) || "null"}</dd></div>)}</dl></section>}
        <label>OPTIONAL DECISION NOTE<textarea aria-label="Policy decision note" value={reason} onChange={(event) => setReason(event.target.value)}/></label>
        <div className="tabs">{editing ? <><button disabled={busy} onClick={() => void saveEdit()}>SAVE NEW REVISION</button><button onClick={() => setEditing(false)}>CANCEL</button></> : <button disabled={!revision || busy} onClick={beginEdit}>EDIT AS NEW REVISION</button>}{(["APPROVE", "REJECT", "RESET", "SUPERSEDE"] as const).map((action) => <button key={action} disabled={!revision || busy || (action !== "RESET" && revision.status !== "UNREVIEWED")} onClick={() => revision && void decide(action, [revision.revisionId])}>{action}</button>)}</div>
      </>}</section>
    </div>
    <section className="panel vertical" aria-label="Bulk Owner Policy decisions"><p className="eyebrow">BULK REVIEW</p><h3>{bulkRevisionIds.size} independent candidate revision{bulkRevisionIds.size === 1 ? "" : "s"} selected</h3><p>Each selected revision receives its own immutable decision record and canonical content hash.</p><div className="tabs"><button disabled={busy || bulkRevisionIds.size === 0} onClick={() => void decide("APPROVE", [...bulkRevisionIds])}>APPROVE SELECTED</button><button disabled={busy || bulkRevisionIds.size === 0} onClick={() => void decide("REJECT", [...bulkRevisionIds])}>REJECT SELECTED</button></div></section>
  </>;
}
