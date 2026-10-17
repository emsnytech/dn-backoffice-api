import { useEffect, useState } from "react";

// Charge une route de notre serveur (jamais l'API Démarche Numérique directement).
export function useApi<T>(path: string) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    fetch(path)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
        return body as T;
      })
      .then((data) => !cancelled && setState({ data, loading: false }))
      .catch((e: Error) => !cancelled && setState({ error: e.message, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [path]);

  return state;
}
