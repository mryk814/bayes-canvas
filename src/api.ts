import { useCallback, useEffect, useState } from "react";
import type { State } from "../shared/contracts.ts";

export class ApiError extends Error {
  problems: string[];
  constructor(message: string, problems: string[] = []) {
    super(message);
    this.problems = problems;
  }
}

export async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError("サーバーに届きませんでした。npm run dev のターミナルが開いているか確認してください");
  }
  const json = await res.json();
  if (!res.ok) throw new ApiError(json.error ?? `HTTP ${res.status}`, json.problems ?? []);
  return json as T;
}

type Loaded = { status: "ready"; state: State; agentConnected: boolean; dataPath: string };
export type AppData = { status: "loading" } | { status: "error"; message: string } | Loaded;

// The server is the source of truth. The page re-reads it whenever the stream says something changed.
export function useAppData() {
  const [data, setData] = useState<AppData>({ status: "loading" });
  const [live, setLive] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/state");
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      setData({ status: "ready", ...json });
    } catch {
      setData((d) =>
        d.status === "ready" ? d : { status: "error", message: "サーバーから状態を読めませんでした。npm run dev を起動してから再読み込みしてください" },
      );
    }
  }, []);

  useEffect(() => {
    void reload();
    const es = new EventSource("/api/stream");
    es.onopen = () => {
      setLive(true);
      void reload();
    };
    es.onerror = () => setLive(false);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as { kind: string; agentConnected: boolean };
      if (e.kind === "agent") {
        setData((d) => (d.status === "ready" ? { ...d, agentConnected: e.agentConnected } : d));
      } else {
        void reload();
      }
    };
    return () => es.close();
  }, [reload]);

  return { data, live, reload };
}

// Runs one server action at a time and keeps the failure next to the control that caused it.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err)));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, busy, error, clear: () => setError(null) };
}

export function useStoredState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage unavailable: the draft just won't survive a reload
    }
  }, [key, value]);
  return [value, setValue] as const;
}
