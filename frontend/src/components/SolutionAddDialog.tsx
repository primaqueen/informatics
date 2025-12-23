import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Button,
  CircularProgress,
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
import React, { Suspense, useEffect, useState } from "react";
import type { Task, TaskSolution } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { SOLUTION_TYPE_LABELS, SOLUTION_TYPE_ORDER } from "../solutions";
import type { SolutionType } from "../solutions";

const MonacoEditor = React.lazy(() => import("@monaco-editor/react"));

interface Props {
  open: boolean;
  task: Task | null;
  defaultType?: SolutionType | null;
  solution?: TaskSolution | null;
  onClose: () => void;
  onSaved: (internalId: string, solution: TaskSolution) => void;
  onUpdated?: (internalId: string, solution: TaskSolution) => void;
}

export function SolutionAddDialog({
  open,
  task,
  defaultType,
  solution,
  onClose,
  onSaved,
  onUpdated,
}: Props) {
  const [solutionType, setSolutionType] = useState<SolutionType>("analytical");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (solution) {
      setSolutionType(solution.type);
      setTitle(solution.title ?? "");
      setBody(solution.body ?? "");
    } else {
      setSolutionType(defaultType ?? "analytical");
      setTitle("");
      setBody("");
    }
    setError(null);
  }, [open, defaultType, solution]);

  const handleSave = async () => {
    if (!task) return;
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      setError("Заполните решение.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/__admin/solutions/${task.internal_id}`, {
        method: solution ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: solution?.id,
          type: solutionType,
          title: title.trim() ? title.trim() : undefined,
          body,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} при сохранении решения`);
      const data = (await res.json()) as { solution?: TaskSolution };
      if (!data.solution) throw new Error("Сервер не вернул решение");
      if (solution && onUpdated) {
        onUpdated(task.internal_id, data.solution);
      } else if (!solution) {
        onSaved(task.internal_id, data.solution);
      }
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
      fullWidth
      maxWidth="lg"
      PaperProps={{ sx: { display: "flex", flexDirection: "column" } }}
    >
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography fontWeight={700}>{solution ? "Редактирование решения" : "Новое решение"}</Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {task ? `${task.internal_id} — № ${task.task_number ?? "без номера"}` : ""}
            </Typography>
          </Box>
          <IconButton aria-label="Закрыть" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers sx={{ flex: 1, minHeight: 0 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ height: "100%" }}>
          <Box sx={{ flex: 1, minWidth: 0, overflow: "auto" }}>
            <Stack spacing={2}>
              <TextField
                select
                label="Тип решения"
                value={solutionType}
                disabled={Boolean(solution)}
                onChange={(event) => setSolutionType(event.target.value as SolutionType)}
              >
                {SOLUTION_TYPE_ORDER.map((type) => (
                  <MenuItem key={type} value={type}>
                    {SOLUTION_TYPE_LABELS[type]}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                label="Заголовок (опционально)"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Решение (Markdown)
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

          <Box sx={{ flex: 1, minWidth: 0, overflow: "auto" }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Превью
            </Typography>
            <MarkdownRenderer markdown={body} />
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Отмена
        </Button>
        <Button onClick={handleSave} variant="contained" startIcon={<AddIcon />} disabled={saving || !task}>
          {saving ? "Сохранение…" : solution ? "Сохранить" : "Добавить"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
