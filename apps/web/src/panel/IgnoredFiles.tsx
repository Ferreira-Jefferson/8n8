import type { IgnoredFile, IgnoreReason } from "@8n8/model";

const REASONS: Record<IgnoreReason, string> = {
  "too-large": "maior que 1 MB",
  "not-utf8": "não está em UTF-8",
  unreadable: "não foi possível ler",
  symlink: "link simbólico não seguido",
};

/** The files left out of the map, each with its reason; nothing when none (PROJ-06). */
export function IgnoredFiles({ ignored }: { ignored: IgnoredFile[] }) {
  if (ignored.length === 0) return null;
  return (
    <section aria-label="Arquivos ignorados" className="ignored-files">
      <h3>Arquivos ignorados</h3>
      <ul>
        {ignored.map((f) => (
          <li key={f.path}>{`${f.path} — ${REASONS[f.reason]}`}</li>
        ))}
      </ul>
    </section>
  );
}
