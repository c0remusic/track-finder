import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ProviderResult } from "@/lib/providers/types";

export function AchatSection({ results }: { results: ProviderResult[] }) {
  if (results.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucune plateforme trouvée.</p>;
  }

  return (
    <div className="grid gap-3">
      {results.map((r) => (
        <Card key={r.platform} className="flex items-center justify-between p-4">
          <div>
            <p className="font-medium">{r.platform}</p>
            {r.status === "found" && r.matchedArtist && r.matchedTitle && (
              <p className="text-sm text-muted-foreground">
                {r.matchedArtist} — {r.matchedTitle}
              </p>
            )}
          </div>
          {r.status === "found" && r.purchaseUrl ? (
            <a
              href={r.purchaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline"
            >
              Voir l&apos;offre
            </a>
          ) : (
            <Badge variant="destructive">Indisponible pour l&apos;instant</Badge>
          )}
        </Card>
      ))}
    </div>
  );
}
