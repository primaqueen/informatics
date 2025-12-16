import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React, { Suspense, useEffect, useMemo, useState } from "react";
import type { AnswerType, Task, TaskOption, TaskOverride } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";

const MonacoEditor = React.lazy(() => import("@monaco-editor/react"));

interface Props {
  open: boolean;
  task: Task | null;
  onClose: () => void;
  onSaved: (internalId: string, override: TaskOverride) => void;
}

function normalizeAnswerType(value: unknown, fallback: AnswerType): AnswerType {
  if (value === "short_answer" || value === "single_choice" || value === "multiple_choice")
    return value;
  return fallback;
}

function normalizeOptions(value: unknown): TaskOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const optionValue = raw.value == null ? "" : String(raw.value);
      const text = typeof raw.text === "string" ? raw.text : "";
      return optionValue ? { value: optionValue, text } : null;
    })
    .filter((item): item is TaskOption => Boolean(item));
}

function normalizeKesCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const codes = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(codes));
}

function deriveKesCodes(task: Task): string[] {
  const codes = (task.meta?.["КЭС"] ?? [])
    .map((value) => String(value).split(" ")[0]?.trim())
    .filter(Boolean);
  return Array.from(new Set(codes));
}

function nextOptionValue(options: TaskOption[]): string {
  const numbers = options
    .map((opt) => Number(opt.value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const max = numbers.length ? Math.max(...numbers) : 0;
  return String(max + 1);
}

export function TaskEditorDialog({ open, task, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceHtml, setSourceHtml] = useState<string | null>(null);
  const [sourceHtmlLoading, setSourceHtmlLoading] = useState(false);
  const [sourceHtmlError, setSourceHtmlError] = useState<string | null>(null);

  const [answerType, setAnswerType] = useState<AnswerType>("short_answer");
  const [kesCodes, setKesCodes] = useState<string[]>([]);
  const [hint, setHint] = useState("");
  const [options, setOptions] = useState<TaskOption[]>([]);
  const [body, setBody] = useState("");

  const canEdit = import.meta.env.DEV && Boolean(task);

  useEffect(() => {
    if (!open || !task) return;
    if (!import.meta.env.DEV) return;

    let cancelled = false;
    setError(null);
    setLoading(true);

    async function loadExisting() {
      try {
        const res = await fetch(`/__admin/task/${task.internal_id}`);
        if (!res.ok) {
          if (res.status !== 404) {
            throw new Error(`HTTP ${res.status} при загрузке оверрайда`);
          }
          // Нет файла — префилл из текущих данных задачи.
          if (cancelled) return;
          setAnswerType(task.answer_type);
          setKesCodes(deriveKesCodes(task));
          setHint(task.hint ?? "");
          setOptions(task.options ?? []);
          setBody((task.question_override_md ?? task.question_md ?? "").trimEnd() + "\n");
          return;
        }

        const data = (await res.json()) as {
          frontmatter?: Record<string, unknown>;
          body?: string;
        };
        if (cancelled) return;

        const frontmatter = data.frontmatter ?? {};
        setAnswerType(normalizeAnswerType(frontmatter.answer_type, task.answer_type));
        const parsedKes = normalizeKesCodes(frontmatter.kes);
        setKesCodes(parsedKes.length ? parsedKes : deriveKesCodes(task));
        setHint(typeof frontmatter.hint === "string" ? frontmatter.hint : task.hint ?? "");
        const parsedOptions = normalizeOptions(frontmatter.options);
        setOptions(parsedOptions.length ? parsedOptions : task.options ?? []);
        setBody(typeof data.body === "string" ? data.body : "");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadExisting();
    return () => {
      cancelled = true;
    };
  }, [open, task]);

  useEffect(() => {
    if (!open || !task) return;
    if (!import.meta.env.DEV) return;

    let cancelled = false;
    setSourceHtml(null);
    setSourceHtmlError(null);
    setSourceHtmlLoading(true);

    async function loadSource() {
      try {
        const res = await fetch(`/__admin/task-source/${task.internal_id}`);
        if (res.status === 404) return;
        if (!res.ok) throw new Error(`HTTP ${res.status} при загрузке источника`);
        const data = (await res.json()) as { question_html?: unknown };
        if (cancelled) return;
        setSourceHtml(typeof data.question_html === "string" ? data.question_html : "");
      } catch (e) {
        if (cancelled) return;
        setSourceHtmlError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setSourceHtmlLoading(false);
      }
    }

    loadSource();
    return () => {
      cancelled = true;
    };
  }, [open, task]);

  const preview = useMemo(
    () => ({
      answer_type: answerType,
      kes: kesCodes,
      hint,
      options,
      body,
    }),
    [answerType, body, hint, kesCodes, options],
  );

  const setOptionValue = (index: number, value: string) => {
    setOptions((prev) => prev.map((opt, idx) => (idx === index ? { ...opt, value } : opt)));
  };
  const setOptionText = (index: number, text: string) => {
    setOptions((prev) => prev.map((opt, idx) => (idx === index ? { ...opt, text } : opt)));
  };
  const removeOption = (index: number) => {
    setOptions((prev) => prev.filter((_opt, idx) => idx !== index));
  };
  const addOption = () => {
    setOptions((prev) => [...prev, { value: nextOptionValue(prev), text: "" }]);
  };

  const handleSave = async () => {
    if (!task) return;
    setSaving(true);
    setError(null);
    try {
      const payloadFrontmatter: Record<string, unknown> = {
        answer_type: answerType,
        kes: kesCodes,
        hint,
      };
      if (answerType === "single_choice") payloadFrontmatter.options = options;

      const res = await fetch(`/__admin/task/${task.internal_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frontmatter: payloadFrontmatter, body }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} при сохранении оверрайда`);
      const data = (await res.json()) as { override: TaskOverride };
      onSaved(task.internal_id, data.override);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      PaperProps={{ sx: { display: "flex", flexDirection: "column" } }}
    >
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography fontWeight={700}>Редактирование</Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {task ? `${task.internal_id} — № ${task.task_number ?? "без номера"}` : ""}
            </Typography>
          </Box>
          <IconButton aria-label="Закрыть" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {!canEdit ? (
          <Typography color="text.secondary">Редактор доступен только в dev.</Typography>
        ) : loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ height: "100%" }}>
            <Box sx={{ flex: 1, minWidth: 0, overflow: "auto" }}>
              <Stack spacing={2}>
                <TextField
                  select
                  label="Тип ответа"
                  value={answerType}
                  onChange={(event) => setAnswerType(event.target.value as AnswerType)}
                >
                  <MenuItem value="short_answer">short_answer</MenuItem>
                  <MenuItem value="single_choice">single_choice</MenuItem>
                </TextField>

                <TextField
                  label="КЭС (read-only)"
                  value={preview.kes.join(", ")}
                  InputProps={{ readOnly: true }}
                />

                <TextField
                  label="Подсказка"
                  value={hint}
                  onChange={(event) => setHint(event.target.value)}
                  multiline
                  minRows={2}
                />

                {answerType === "single_choice" ? (
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                      <Typography variant="subtitle2">Варианты ответа</Typography>
                      <Button size="small" startIcon={<AddIcon />} onClick={addOption}>
                        Добавить
                      </Button>
                    </Stack>
                    <Stack spacing={1}>
                      {options.map((opt, index) => (
                        <Stack
                          key={`${opt.value}-${index}`}
                          direction={{ xs: "column", sm: "row" }}
                          spacing={1}
                          alignItems={{ sm: "flex-start" }}
                        >
                          <TextField
                            label="Value"
                            value={opt.value}
                            onChange={(event) => setOptionValue(index, event.target.value)}
                            sx={{ width: { sm: 120 } }}
                          />
                          <TextField
                            label="Text (Markdown)"
                            value={opt.text}
                            onChange={(event) => setOptionText(index, event.target.value)}
                            multiline
                            minRows={2}
                            sx={{ flexGrow: 1 }}
                          />
                          <IconButton
                            aria-label="Удалить вариант"
                            onClick={() => removeOption(index)}
                            sx={{ mt: { xs: 0, sm: 1 } }}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Stack>
                      ))}
                      {!options.length ? (
                        <Typography variant="body2" color="text.secondary">
                          Пока нет вариантов.
                        </Typography>
                      ) : null}
                    </Stack>
                  </Box>
                ) : null}

                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Текст задачи (Markdown)
                  </Typography>
                  <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                    <Suspense
                      fallback={
                        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                          <CircularProgress size={22} />
                        </Box>
                      }
                    >
                      <MonacoEditor
                        height="360px"
                        defaultLanguage="markdown"
                        value={body}
                        onChange={(value) => setBody(value ?? "")}
                        options={{
                          minimap: { enabled: false },
                          wordWrap: "on",
                          fontSize: 14,
                          scrollBeyondLastLine: false,
                        }}
                      />
                    </Suspense>
                  </Box>
                </Box>

                {error ? <Typography color="error">{error}</Typography> : null}
              </Stack>
            </Box>

            <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <Box sx={{ flex: 1, minWidth: 0, overflow: "auto" }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Превью (MD)
                </Typography>
                <MarkdownRenderer markdown={preview.body} />
                {preview.hint.trim() ? (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                      Подсказка
                    </Typography>
                    <MarkdownRenderer markdown={preview.hint} />
                  </Box>
                ) : null}
                {preview.answer_type === "single_choice" && preview.options.length ? (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                      Варианты ответа
                    </Typography>
                    <Stack spacing={0.5}>
                      {preview.options.map((opt) => (
                        <Stack key={opt.value} direction="row" spacing={1} alignItems="baseline">
                          <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 20 }}>
                            {opt.value}.
                          </Typography>
                          <Box sx={{ flexGrow: 1 }}>
                            <MarkdownRenderer markdown={opt.text} inline />
                          </Box>
                        </Stack>
                      ))}
                    </Stack>
                  </Box>
                ) : null}

                <Divider sx={{ my: 2 }} />

                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Источник (HTML)
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  question_html из tasks.jsonl
                </Typography>
                {sourceHtmlLoading ? (
                  <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                    <CircularProgress />
                  </Box>
                ) : sourceHtmlError ? (
                  <Typography color="error">{sourceHtmlError}</Typography>
                ) : sourceHtml !== null ? (
                  <MarkdownRenderer markdown={sourceHtml} />
                ) : (
                  <Typography color="text.secondary">Источник не найден.</Typography>
                )}
              </Box>
            </Box>
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Отмена
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving || loading || !task}>
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
