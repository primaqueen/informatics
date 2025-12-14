import {
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Box,
  IconButton,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import React from "react";
import type { Task } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface Props {
  task: Task;
  onEdit?: (task: Task) => void;
}

export function TaskCard({ task, onEdit }: Props) {
  const question = task.question_override_md ?? task.question_html_clean;
  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Chip
            size="small"
            label={task.task_number === null ? "Без номера" : `№ ${task.task_number}`}
            color="secondary"
            variant="outlined"
          />
          <Chip size="small" label={task.internal_id || task.qid} />
          {task.answer_type !== "short_answer" && (
            <Chip size="small" label={`Тип: ${task.answer_type}`} color="info" />
          )}
          {task.meta?.["Тип ответа"] && (
            <Chip size="small" label={task.meta["Тип ответа"]} variant="outlined" />
          )}
          {task.has_override ? <Chip size="small" label="MDX" color="success" /> : null}
          <Box sx={{ flexGrow: 1 }} />
          {import.meta.env.DEV && onEdit ? (
            <IconButton size="small" aria-label="Редактировать" onClick={() => onEdit(task)}>
              <EditIcon fontSize="small" />
            </IconButton>
          ) : null}
        </Stack>
        <MarkdownRenderer markdown={question} />
        {task.hint?.trim() ? (
          <Box sx={{ mt: 1 }}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Подсказка
            </Typography>
            <MarkdownRenderer markdown={task.hint} />
          </Box>
        ) : null}
        {task.answer_type === "single_choice" && task.options?.length ? (
          <Box sx={{ mt: 1 }}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Варианты ответа
            </Typography>
            <Stack spacing={0.5}>
              {task.options.map((option) => (
                <Stack key={option.value} direction="row" spacing={1} alignItems="baseline">
                  <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 20 }}>
                    {option.value}.
                  </Typography>
                  <Box sx={{ flexGrow: 1 }}>
                    <MarkdownRenderer markdown={option.text} inline />
                  </Box>
                </Stack>
              ))}
            </Stack>
          </Box>
        ) : null}
        {task.meta?.["КЭС"]?.length ? (
          <Box sx={{ mt: 1 }}>
            <Divider sx={{ my: 1 }} />
            <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={1}>
              {task.meta["КЭС"].map((item) => (
                <Chip key={item} size="small" label={item} variant="outlined" />
              ))}
            </Stack>
          </Box>
        ) : null}
      </CardContent>
    </Card>
  );
}
