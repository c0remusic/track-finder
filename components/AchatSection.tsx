"use client";

import { motion } from "motion/react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Slot } from "@/lib/providers/types";

export function AchatSection({ results }: { results: Slot[] }) {
  if (results.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucune plateforme trouvée.</p>;
  }

  return (
    <div className="grid gap-3">
      {results.map((r, i) => (
        <motion.div
          key={r.platform}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05, duration: 0.25, ease: "easeOut" }}
        >
          <Card className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{r.platform}</p>
              {r.status === "found" && r.matchedArtist && r.matchedTitle && (
                <p className="text-sm text-muted-foreground">
                  {r.matchedArtist} — {r.matchedTitle}
                </p>
              )}
            </div>
            {r.status === "pending" ? (
              <span
                className="h-4 w-16 animate-pulse rounded bg-muted"
                aria-label="Recherche en cours"
              />
            ) : (
              // key={r.status} forces a remount exactly once, the moment this
              // row leaves "pending" — that's what makes `initial` replay as
              // a fade/scale-in. AnimatePresence was tried here first but got
              // stuck mid-exit under the rapid-fire SSE updates a cache-hit
              // search produces (5 provider events within milliseconds each
              // re-rendering every row) — plain mount-triggered animation
              // has no exit to coordinate, so nothing to get stuck on.
              <motion.span
                key={r.status}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.15 }}
              >
                {r.status === "found" && r.purchaseUrl ? (
                  <a
                    href={r.purchaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-primary underline underline-offset-2"
                  >
                    Voir l&apos;offre
                  </a>
                ) : r.status === "not_found" ? (
                  // Distinct from "error": the search genuinely ran and found
                  // nothing relevant — not a technical failure, so neutral
                  // styling rather than the destructive badge used for "error".
                  <Badge variant="secondary">Non trouvé</Badge>
                ) : (
                  <Badge variant="destructive">Indisponible pour l&apos;instant</Badge>
                )}
              </motion.span>
            )}
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
