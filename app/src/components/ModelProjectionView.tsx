import type { ModelViewProjection, ProjectionLine } from '../lib/modelViewProjections';

interface ModelProjectionViewProps {
  projection: ModelViewProjection;
  onCopy: (value: string) => void;
  onSelectEntity: (entityId: string) => void;
}

export function ModelProjectionView({
  projection,
  onCopy,
  onSelectEntity,
}: ModelProjectionViewProps) {
  return (
    <div className="projection-view">
      <div className="projection-header">
        <div>
          <h2>{projection.title}</h2>
          <p>{projection.purpose}</p>
        </div>
        <button className="projection-copy-button" type="button" onClick={() => onCopy(projection.copyText)}>
          コピー
        </button>
      </div>
      <div className="projection-metrics" aria-label={`${projection.title} metrics`}>
        {projection.metrics.map((metric) => (
          <div key={`${projection.id}-${metric.label}`}>
            <span>{metric.value}</span>
            <strong>{metric.label}</strong>
          </div>
        ))}
      </div>
      <div className="projection-consumes" aria-label="Projection sources">
        {projection.consumes.map((use) => (
          <span key={`${projection.id}-${use.source}`}>
            {use.source}: {use.fields.join(', ')}
          </span>
        ))}
      </div>
      <div className="projection-sections">
        {projection.sections.map((section) => (
          <section className="projection-section" key={`${projection.id}-${section.id}`}>
            <div className="projection-section-title">
              <h3>{section.title}</h3>
              {section.summary ? <span>{section.summary}</span> : null}
            </div>
            <div className="projection-rows">
              {section.rows.map((row) => (
                <ProjectionRow
                  key={`${projection.id}-${section.id}-${row.id}`}
                  row={row}
                  onSelectEntity={onSelectEntity}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ProjectionRow({
  row,
  onSelectEntity,
}: {
  row: ProjectionLine;
  onSelectEntity: (entityId: string) => void;
}) {
  const entityIds = [row.entityId, ...(row.entityIds ?? [])].filter((entityId): entityId is string => Boolean(entityId));
  const content = (
    <>
      <span className={row.monospace ? 'projection-row-text projection-row-code' : 'projection-row-text'}>
        {row.text}
      </span>
      {row.detail ? <small>{row.detail}</small> : null}
      {entityIds.length ? (
        <span className="projection-entity-chips">
          {entityIds.map((entityId) => (
            <span key={entityId}>{entityId}</span>
          ))}
        </span>
      ) : null}
    </>
  );

  const className = `projection-row projection-row-${row.tone ?? 'default'}`;
  if (!entityIds.length) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button className={className} type="button" onClick={() => onSelectEntity(entityIds[0])}>
      {content}
    </button>
  );
}
