import { useCallback, useEffect, useMemo, useState } from "react";
import type { Task, TaskOverride, TaskSolution } from "../types";

type RawTask = Omit<Task, "task_number" | "answer" | "solutions" | "has_override" | "question_override_md">;

interface UseTasksResult {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  applyOverride: (internalId: string, override: TaskOverride | null) => void;
  applyAnswer: (internalId: string, answer: string | null) => void;
  addSolution: (internalId: string, solution: TaskSolution) => void;
  updateSolution: (internalId: string, solution: TaskSolution) => void;
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
        const [tasksRes, numbersRes, overridesRes, answersRes, solutionsRes] = await Promise.all([
          fetch("/tasks_clean.jsonl"),
          fetch("/internal_id_to_task_number.json"),
          fetch("/task_overrides.json"),
          fetch("/answers.json"),
          fetch("/solutions_index.json"),
        ]);

        if (!tasksRes.ok) throw new Error(`HTTP ${tasksRes.status} при загрузке tasks_clean.jsonl`);
        if (!numbersRes.ok)
          throw new Error(`HTTP ${numbersRes.status} при загрузке internal_id_to_task_number.json`);

        const [text, numbers, overridesRaw, answersRaw, solutionsRaw] = await Promise.all([
          tasksRes.text(),
          numbersRes.json(),
          overridesRes.ok ? overridesRes.json() : Promise.resolve({}),
          answersRes.ok ? answersRes.json() : Promise.resolve({}),
          solutionsRes.ok ? solutionsRes.json() : Promise.resolve({}),
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

        const answerMap = new Map<string, string | null>();
        Object.entries(answersRaw as Record<string, string | null>).forEach(([internalId, answer]) => {
          const key = internalId.toUpperCase();
          if (!key) return;
          answerMap.set(key, typeof answer === "string" ? answer : null);
        });

        const solutionsMap = new Map<string, TaskSolution[]>();
        Object.entries(solutionsRaw as Record<string, TaskSolution[]>).forEach(
          ([internalId, solutions]) => {
            const key = internalId.toUpperCase();
            if (!key) return;
            if (!Array.isArray(solutions)) return;
            solutionsMap.set(key, solutions);
          },
        );

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
            answer: answerMap.get(task.internal_id.toUpperCase()) ?? null,
            solutions: solutionsMap.get(task.internal_id.toUpperCase()) ?? [],
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

  const applyAnswer = useCallback((internalId: string, answer: string | null) => {
    const key = internalId.toUpperCase();
    setTasks((prev) =>
      prev.map((task) => {
        if (task.internal_id.toUpperCase() !== key) return task;
        return {
          ...task,
          answer,
        };
      }),
    );
  }, []);

  const addSolution = useCallback((internalId: string, solution: TaskSolution) => {
    const key = internalId.toUpperCase();
    setTasks((prev) =>
      prev.map((task) => {
        if (task.internal_id.toUpperCase() !== key) return task;
        const nextSolutions = [...(task.solutions ?? []), solution];
        nextSolutions.sort((a, b) => {
          const typeCompare = a.type.localeCompare(b.type);
          if (typeCompare !== 0) return typeCompare;
          const numA = a.num ?? 0;
          const numB = b.num ?? 0;
          return numA - numB;
        });
        return {
          ...task,
          solutions: nextSolutions,
        };
      }),
    );
  }, []);

  const updateSolution = useCallback((internalId: string, solution: TaskSolution) => {
    const key = internalId.toUpperCase();
    setTasks((prev) =>
      prev.map((task) => {
        if (task.internal_id.toUpperCase() !== key) return task;
        const nextSolutions = [...(task.solutions ?? [])];
        const idx = nextSolutions.findIndex((item) => item.id === solution.id);
        if (idx >= 0) {
          nextSolutions[idx] = solution;
        } else {
          nextSolutions.push(solution);
        }
        nextSolutions.sort((a, b) => {
          const typeCompare = a.type.localeCompare(b.type);
          if (typeCompare !== 0) return typeCompare;
          const numA = a.num ?? 0;
          const numB = b.num ?? 0;
          return numA - numB;
        });
        return {
          ...task,
          solutions: nextSolutions,
        };
      }),
    );
  }, []);

  return useMemo(
    () => ({ tasks, loading, error, applyOverride, applyAnswer, addSolution, updateSolution }),
    [addSolution, updateSolution, applyAnswer, applyOverride, tasks, loading, error],
  );
}
