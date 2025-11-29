import { useEffect, useMemo, useState } from "react";
import type { Task } from "../types";

interface UseTasksResult {
  tasks: Task[];
  loading: boolean;
  error: string | null;
}

export function useTasks(): UseTasksResult {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/tasks_clean.jsonl");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (cancelled) return;
        const parsed: Task[] = [];
        for (const line of text.split(/\r?\n/)) {
          if (!line.trim()) continue;
          try {
            parsed.push(JSON.parse(line));
          } catch (e) {
            console.warn("Не удалось распарсить строку", e);
          }
        }
        if (cancelled) return;
        setTasks(parsed);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => ({ tasks, loading, error }), [tasks, loading, error]);
}
