type MetadataValue<T> = { value: T; source: string };

type Metadata = {
  bpm: MetadataValue<number>[];
  key: MetadataValue<string>[];
  genre: MetadataValue<string>[];
  label: MetadataValue<string>[];
};

type Props = {
  // null = still waiting on the "done" event (some providers may still be
  // in flight), as distinct from a resolved-but-empty metadata object.
  metadata: Metadata | null;
};

function Field<T>({ label, values }: { label: string; values: MetadataValue<T>[] }) {
  if (values.length === 0) return null;
  return (
    <div>
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="text-sm text-muted-foreground">
        {values.map((v) => `${v.value} (${v.source})`).join(", ")}
      </dd>
    </div>
  );
}

export function MetadataSection({ metadata }: Props) {
  if (metadata === null) {
    return <p className="text-sm text-muted-foreground">Recherche en cours…</p>;
  }

  const hasAny =
    metadata.bpm.length + metadata.key.length + metadata.genre.length + metadata.label.length > 0;

  if (!hasAny) {
    return <p className="text-sm text-muted-foreground">Aucune métadonnée disponible.</p>;
  }

  return (
    <dl className="grid gap-2">
      <Field label="BPM" values={metadata.bpm} />
      <Field label="Clé" values={metadata.key} />
      <Field label="Genre" values={metadata.genre} />
      <Field label="Label" values={metadata.label} />
    </dl>
  );
}
