"use client";

import { useState } from "react";
import { SearchForm } from "@/components/SearchForm";
import { AchatSection, type Slot } from "@/components/AchatSection";
import { MetadataSection } from "@/components/MetadataSection";
import { Disclaimer } from "@/components/Disclaimer";
import { PROVIDER_NAMES } from "@/lib/providers/names";
import type { ProviderResult } from "@/lib/providers/types";

type Metadata = {
  bpm: { value: number; source: string }[];
  key: { value: string; source: string }[];
  genre: { value: string; source: string }[];
  label: { value: string; source: string }[];
};

export default function Home() {
  const [slots, setSlots] = useState<Record<string, Slot> | null>(null);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSearch(query: string) {
    setIsLoading(true);
    setError(null);
    setMetadata(null);
    setSlots(
      Object.fromEntries(
        PROVIDER_NAMES.map((name) => [name, { platform: name, status: "pending" as const }])
      )
    );

    const source = new EventSource(`/api/search?q=${encodeURIComponent(query)}`);

    source.addEventListener("provider", (event) => {
      const result = JSON.parse(event.data) as ProviderResult;
      setSlots((prev) => (prev ? { ...prev, [result.platform]: result } : prev));
    });

    source.addEventListener("done", (event) => {
      const { metadata: finalMetadata } = JSON.parse(event.data) as { metadata: Metadata };
      setMetadata(finalMetadata);
      setIsLoading(false);
      source.close();
    });

    source.onerror = () => {
      setError("La recherche a échoué. Réessaie dans un instant.");
      setIsLoading(false);
      source.close();
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
          <section>
            <h2 className="mb-3 text-lg font-medium">Metadata</h2>
            <MetadataSection metadata={metadata} />
          </section>
        </div>
      )}

      <Disclaimer />
    </main>
  );
}
