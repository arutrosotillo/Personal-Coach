import { ExternalLink } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  CITATION_BY_ID,
  CITATIONS,
  EVIDENCE_LABEL,
  EVIDENCE_MEANING,
  PHILOSOPHY,
  REASON_CODE_EXPLANATIONS,
  type EvidenceLevel,
} from "@/core/science";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Ciencia · Personal Coach",
};

const EVIDENCE_CLASS: Record<EvidenceLevel, string> = {
  STRONG: "border-emerald-500/40 text-emerald-300",
  REASONABLE: "border-sky-500/40 text-sky-300",
  HEURISTIC: "border-amber-500/40 text-amber-300",
};

function EvidenceBadge({ level }: { level: EvidenceLevel }) {
  return (
    <Badge
      variant="outline"
      className={cn("shrink-0 text-[11px]", EVIDENCE_CLASS[level])}
    >
      {EVIDENCE_LABEL[level]}
    </Badge>
  );
}

/** Enlace fiable a la referencia: DOI si lo hay, si no PubMed. */
function citationHref(doi?: string, pmid?: string): string | null {
  if (doi) return `https://doi.org/${doi}`;
  if (pmid) return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
  return null;
}

export default function SciencePage() {
  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-semibold">Ciencia</h1>
      <p className="text-muted-foreground mb-4 text-sm">
        Por qué esta app entrena como entrena — y qué parte es evidencia y qué
        parte es una decisión nuestra.
      </p>

      <Card className="mb-6">
        <CardContent className="pt-4">
          <h2 className="mb-2 text-sm font-medium">Cómo leer las etiquetas</h2>
          <ul className="space-y-2">
            {(["STRONG", "REASONABLE", "HEURISTIC"] as const).map((level) => (
              <li key={level} className="flex gap-2">
                <EvidenceBadge level={level} />
                <span className="text-muted-foreground text-xs">
                  {EVIDENCE_MEANING[level]}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {PHILOSOPHY.map((section) => (
        <section key={section.id} className="mb-6" id={section.id}>
          <h2 className="mb-1 text-lg font-semibold">{section.title}</h2>
          <p className="text-muted-foreground mb-3 text-sm">{section.intro}</p>
          <ul className="space-y-3">
            {section.principles.map((p) => (
              <li
                key={p.id}
                className="border-border bg-card rounded-lg border p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium">{p.title}</h3>
                  <EvidenceBadge level={p.evidence} />
                </div>
                <p className="text-muted-foreground mt-1 text-sm">
                  {p.summary}
                </p>
                {p.detail ? (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {p.detail}
                  </p>
                ) : null}
                {p.citations.length > 0 ? (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {p.citations
                      .map((id) => CITATION_BY_ID[id])
                      .filter(Boolean)
                      .map((c) => `${c.authors.split(",")[0]} ${c.year}`)
                      .join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="mb-6" id="reglas">
        <h2 className="mb-1 text-lg font-semibold">
          Qué significa cada decisión
        </h2>
        <p className="text-muted-foreground mb-3 text-sm">
          Cada sugerencia del motor lleva un código. Esto es lo que quiere decir
          cada uno.
        </p>
        <ul className="space-y-2">
          {Object.entries(REASON_CODE_EXPLANATIONS).map(([code, text]) => (
            <li
              key={code}
              className="border-border bg-card rounded-lg border p-3"
            >
              <p className="font-mono text-xs">{code}</p>
              <p className="text-muted-foreground mt-1 text-sm">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="bibliografia">
        <h2 className="mb-1 text-lg font-semibold">Bibliografía</h2>
        <p className="text-muted-foreground mb-3 text-sm">
          Todas estas referencias se han verificado una a una contra PubMed,
          Crossref o el editor. Si una cita no se pudo verificar, no aparece
          aquí.
        </p>
        <ul className="space-y-3">
          {CITATIONS.map((c) => {
            const href = citationHref(c.doi, c.pmid);
            return (
              <li
                key={c.id}
                className="border-border bg-card rounded-lg border p-3"
              >
                <p className="text-sm font-medium">{c.title}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {c.authors} ({c.year}). <em>{c.journal}</em>.
                </p>
                <p className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 text-xs">
                  {c.doi ? <span className="tnum">DOI {c.doi}</span> : null}
                  {c.pmid ? <span className="tnum">PMID {c.pmid}</span> : null}
                </p>
                {c.caveat ? (
                  <p className="text-muted-foreground mt-2 text-xs italic">
                    {c.caveat}
                  </p>
                ) : null}
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary mt-2 inline-flex min-h-11 items-center gap-1 text-xs underline underline-offset-2"
                  >
                    Abrir referencia
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </AppShell>
  );
}
