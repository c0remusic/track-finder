"use client";

import { useState } from "react";
import { SearchForm } from "@/components/SearchForm";
import { AchatSection } from "@/components/AchatSection";
import { MetadataSection } from "@/components/MetadataSection";
import { Disclaimer } from "@/components/Disclaimer";
import type { ProviderResult } from "@/lib/providers/types";

type SearchResponse = {
  purchase: ProviderResult[];
  metadata: {
    bpm: { value: number; source: string }[];
    key: { value: string; source: string }[];
    genre: { value: string; source: string }[];
    label: { value: string; source: string }[];
  };
};

export default function Home() {
  const [data, setData] = useState<SearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(query: string) {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        setError("La recherche a échoué. Réessaie dans un instant.");
        return;
      }
      const json = (await response.json()) as SearchResponse;
      setData(json);
    } catch {
      setError("La recherche a échoué. Réessaie dans un instant.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Track finder</h1>
      <SearchForm onSearch={handleSearch} isLoading={isLoading} />

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {data && (
        <div className="mt-8 grid gap-8">
          <section>
            <h2 className="mb-3 text-lg font-medium">Où acheter</h2>
            <AchatSection results={data.purchase} />
          </section>
          <section>
            <h2 className="mb-3 text-lg font-medium">Metadata</h2>
            <MetadataSection metadata={data.metadata} />
          </section>
        </div>
      )}

      <Disclaimer />
    </main>
  );
}
