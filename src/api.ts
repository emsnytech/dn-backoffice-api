import { useCallback, useEffect, useState } from "react";

// Charge une route de notre serveur (jamais l'API Démarche Numérique directement).
// `reload()` relance l'appel en gardant les données affichées pendant le chargement.
export function useApi<T>(path: string) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean; loadedAt?: Date }>({ loading: true });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, error: undefined, loading: true }));
    fetch(path)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
        return body as T;
      })
      .then((data) => !cancelled && setState({ data, loading: false, loadedAt: new Date() }))
      .catch((e: Error) => !cancelled && setState((s) => ({ ...s, error: e.message, loading: false })));
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  return { ...state, reload };
}
