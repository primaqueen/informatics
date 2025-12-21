import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React, { useEffect, useState } from "react";
import type { Task } from "../types";

interface Props {
  open: boolean;
  task: Task | null;
  onClose: () => void;
  onSaved: (internalId: string, answer: string | null) => void;
}

export function AnswerEditorDialog({ open, task, onClose, onSaved }: Props) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !task) return;
    setValue(task.answer ?? "");
    setError(null);
  }, [open, task]);

  const handleSave = async () => {
    if (!task) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/__admin/answer/${task.internal_id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer: value }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status} при сохранении ответа`);
      const data = (await res.json()) as { answer?: string | null };
      onSaved(task.internal_id, data.answer ?? null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography fontWeight={700}>Ответ</Typography>
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
        <Stack spacing={2}>
          <TextField
            label="Ответ"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Оставьте пустым для значения null"
            multiline
            minRows={3}
          />
          {error ? <Typography color="error">{error}</Typography> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Отмена
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving || !task}>
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
