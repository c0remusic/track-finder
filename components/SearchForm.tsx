"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Props = {
  onSearch: (query: string) => void;
  isLoading: boolean;
};

export function SearchForm({ onSearch, isLoading }: Props) {
  const [query, setQuery] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (query.trim()) onSearch(query.trim());
      }}
      className="flex gap-2"
    >
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Artiste - Titre"
        aria-label="Recherche artiste et titre"
      />
      <Button type="submit" disabled={isLoading}>
        {isLoading && <Loader2 className="animate-spin" />}
        {isLoading ? "Recherche..." : "Chercher"}
      </Button>
    </form>
  );
}
