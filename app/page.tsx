"use client";

import { useRef, useState } from "react";
import { SearchForm } from "@/components/SearchForm";
import { AchatSection } from "@/components/AchatSection";
import { Disclaimer } from "@/components/Disclaimer";
import { PROVIDER_NAMES } from "@/lib/providers/names";
import type { ProviderResult, Slot } from "@/lib/providers/types";

export default function Home() {
  const [slots, setSlots] = useState<Record<string, Slot> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow first search (e.g. still waiting on Amazon Music)
  // delivering events into a second search's state after the user re-runs
  // the form before the first stream finished. Every handleSearch call
  // stamps a fresh token and closes whichever EventSource is still open;
  // every listener checks it's still the current token before touching
  // state, so a stale, already-superseded stream can never overwrite a
  // newer search's results.
  const currentSourceRef = useRef<EventSource | null>(null);
  const currentTokenRef = useRef(0);

  function handleSearch(query: string) {
    currentSourceRef.current?.close();
    const token = ++currentTokenRef.current;

    setIsLoading(true);
    setError(null);
    setSlots(
      Object.fromEntries(
        PROVIDER_NAMES.map((name) => [name, { platform: name, status: "pending" as const }])
      )
    );

    const source = new EventSource(`/api/search?q=${encodeURIComponent(query)}`);
    currentSourceRef.current = source;

    source.addEventListener("provider", (event) => {
      if (currentTokenRef.current !== token) return;
      const result = JSON.parse(event.data) as ProviderResult;
      setSlots((prev) => (prev ? { ...prev, [result.platform]: result } : prev));
    });

    source.addEventListener("done", () => {
      source.close();
      if (currentTokenRef.current !== token) return;
      setIsLoading(false);
    });

    source.onerror = () => {
      source.close();
      if (currentTokenRef.current !== token) return;
      setError("La recherche a échoué. Réessaie dans un instant.");
      setIsLoading(false);
    };
  }

  const orderedSlots = slots ? PROVIDER_NAMES.map((name) => slots[name]) : [];

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Track finder</h1>
      <SearchForm onSearch={handleSearch} isLoading={isLoading} />

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {slots && (
        <div className="mt-8 grid gap-8">
          <section>
            <h2 className="mb-3 text-lg font-medium">Où acheter</h2>
            <AchatSection results={orderedSlots} />
          </section>
        </div>
      )}

      <Disclaimer />
    </main>
  );
}
