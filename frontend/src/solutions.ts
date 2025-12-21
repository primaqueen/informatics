export type SolutionType = "analytical" | "program" | "excel" | "other";

export const SOLUTION_TYPE_ORDER: SolutionType[] = [
  "analytical",
  "program",
  "excel",
  "other",
];

export const SOLUTION_TYPE_LABELS: Record<SolutionType, string> = {
  analytical: "Аналитическое",
  program: "Программное",
  excel: "Excel",
  other: "Другое",
};

export function isSolutionType(value: string): value is SolutionType {
  return (SOLUTION_TYPE_ORDER as string[]).includes(value);
}

export function normalizeSolutionType(value: unknown): SolutionType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isSolutionType(normalized) ? normalized : null;
}
