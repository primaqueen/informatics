import { useCallback, useEffect, useMemo, useState } from "react";
import type { Task, TaskOverride } from "../types";

type RawTask = Omit<Task, "task_number">;

interface UseTasksResult {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  applyOverride: (internalId: string, override: TaskOverride | null) => void;
}

export function useTasks(): UseTasksResult {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [tasksRes, numbersRes, overridesRes] = await Promise.all([
          fetch("/tasks_clean.jsonl"),
          fetch("/internal_id_to_task_number.json"),
          fetch("/task_overrides.json"),
        ]);

        if (!tasksRes.ok) throw new Error(`HTTP ${tasksRes.status} при загрузке tasks_clean.jsonl`);
        if (!numbersRes.ok)
          throw new Error(`HTTP ${numbersRes.status} при загрузке internal_id_to_task_number.json`);

        const [text, numbers, overridesRaw] = await Promise.all([
          tasksRes.text(),
          numbersRes.json(),
          overridesRes.ok ? overridesRes.json() : Promise.resolve({}),
        ]);
        if (cancelled) return;
        const numberMap = new Map<string, number | null>();

        Object.entries(numbers as Record<string, number | null>).forEach(([internalId, taskNumber]) => {
          numberMap.set(internalId.toUpperCase(), taskNumber ?? null);
        });

        const overrideMap = new Map<string, TaskOverride>();
        Object.entries(overridesRaw as Record<string, TaskOverride>).forEach(([internalId, override]) => {
          if (!override) return;
          overrideMap.set(internalId.toUpperCase(), override);
        });

        const parsed: RawTask[] = [];
        for (const line of text.split(/\r?\n/)) {
          if (!line.trim()) continue;
          try {
            parsed.push(JSON.parse(line) as RawTask);
          } catch (e) {
            console.warn("Не удалось распарсить строку", e);
          }
        }
        if (cancelled) return;

        const tasksWithNumbers: Task[] = parsed.map((task) => {
          const override = overrideMap.get(task.internal_id.toUpperCase());
          return {
            ...task,
            task_number: numberMap.get(task.internal_id.toUpperCase()) ?? null,
            has_override: Boolean(override),
            question_override_md: override?.question_md,
            hint: override?.hint ?? task.hint,
            answer_type: override?.answer_type ?? task.answer_type,
            options: override?.options ?? task.options,
          };
        });

        setTasks(tasksWithNumbers);
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

  const applyOverride = useCallback((internalId: string, override: TaskOverride | null) => {
    const key = internalId.toUpperCase();
    setTasks((prev) =>
      prev.map((task) => {
        if (task.internal_id.toUpperCase() !== key) return task;
        return {
          ...task,
          has_override: Boolean(override),
          question_override_md: override?.question_md,
          hint: override?.hint ?? task.hint,
          answer_type: override?.answer_type ?? task.answer_type,
          options: override?.options ?? task.options,
        };
      }),
    );
  }, []);

  return useMemo(() => ({ tasks, loading, error, applyOverride }), [applyOverride, tasks, loading, error]);
}
