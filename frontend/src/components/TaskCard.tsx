import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import EditIcon from "@mui/icons-material/Edit";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import React, { useMemo, useState } from "react";
import type { Task, TaskSolution } from "../types";
import { SOLUTION_TYPE_LABELS, SOLUTION_TYPE_ORDER } from "../solutions";
import type { SolutionType } from "../solutions";
import { AnswerEditorDialog } from "./AnswerEditorDialog";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { SolutionAddDialog } from "./SolutionAddDialog";

interface Props {
  task: Task;
  onEdit?: (task: Task) => void;
  onKesClick?: (raw: string, anchorEl: HTMLElement) => void;
  onAnswerSaved?: (internalId: string, answer: string | null) => void;
  onSolutionAdded?: (internalId: string, solution: TaskSolution) => void;
  onSolutionUpdated?: (internalId: string, solution: TaskSolution) => void;
}

export function TaskCard({
  task,
  onEdit,
  onKesClick,
  onAnswerSaved,
  onSolutionAdded,
  onSolutionUpdated,
}: Props) {
  const question = task.question_override_md ?? task.question_html_clean;
  const canEdit = import.meta.env.DEV;
  const [drawerType, setDrawerType] = useState<SolutionType | null>(null);
  const [answerDialogOpen, setAnswerDialogOpen] = useState(false);
  const [solutionDialogOpen, setSolutionDialogOpen] = useState(false);
  const [solutionDialogType, setSolutionDialogType] = useState<SolutionType | null>(null);
  const [solutionDialogSolution, setSolutionDialogSolution] = useState<TaskSolution | null>(null);

  const solutionsByType = useMemo(() => {
    const grouped: Record<SolutionType, TaskSolution[]> = {
      analytical: [],
      program: [],
      excel: [],
      other: [],
    };
    task.solutions?.forEach((solution) => {
      grouped[solution.type]?.push(solution);
    });
    SOLUTION_TYPE_ORDER.forEach((type) => {
      grouped[type].sort((a, b) => {
        const numA = a.num ?? 0;
        const numB = b.num ?? 0;
        return numA - numB;
      });
    });
    return grouped;
  }, [task.solutions]);

  const activeSolutions = drawerType ? solutionsByType[drawerType] : [];
  const answerText = typeof task.answer === "string" ? task.answer.trim() : "";

  const handleOpenDrawer = (type: SolutionType) => {
    setDrawerType(type);
  };

  const handleAddSolution = (type?: SolutionType | null) => {
    setSolutionDialogSolution(null);
    setSolutionDialogType(type ?? "analytical");
    setSolutionDialogOpen(true);
  };

  const handleEditSolution = (solution: TaskSolution) => {
    setSolutionDialogSolution(solution);
    setSolutionDialogType(solution.type);
    setSolutionDialogOpen(true);
  };

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
          {canEdit && onEdit ? (
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
        {task.attachments?.length ? (
          <Box sx={{ mt: 1 }}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Файлы
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={1}>
              {task.attachments.map((att) => {
                const label = att.text?.trim() || att.href;
                const href = att.href.startsWith("http") ? att.href : `/assets/${att.href}`;
                return (
                  <Chip
                    key={att.href}
                    size="small"
                    label={label}
                    component="a"
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    clickable
                    variant="outlined"
                  />
                );
              })}
            </Stack>
          </Box>
        ) : null}

        <Box sx={{ mt: 1 }}>
          <Divider sx={{ my: 1 }} />
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="subtitle2">Ответ</Typography>
            {canEdit && onAnswerSaved ? (
              <IconButton
                size="small"
                aria-label="Редактировать ответ"
                onClick={() => setAnswerDialogOpen(true)}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            ) : null}
          </Stack>
          {answerText ? (
            <MarkdownRenderer markdown={answerText} />
          ) : (
            <Typography variant="body2" color="text.secondary">
              Ответ не задан.
            </Typography>
          )}
        </Box>

        <Box sx={{ mt: 1 }}>
          <Divider sx={{ my: 1 }} />
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2">Решения</Typography>
          {canEdit && onSolutionAdded ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => handleAddSolution(null)}
            >
                Добавить решение
              </Button>
            ) : null}
          </Stack>
          <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={1}>
            {SOLUTION_TYPE_ORDER.map((type) => {
              const count = solutionsByType[type].length;
              const label = count
                ? `${SOLUTION_TYPE_LABELS[type]} (${count})`
                : SOLUTION_TYPE_LABELS[type];
              return (
                <Chip
                  key={type}
                  size="small"
                  label={label}
                  variant={count ? "filled" : "outlined"}
                  clickable
                  onClick={() => handleOpenDrawer(type)}
                />
              );
            })}
          </Stack>
        </Box>

        {task.meta?.["КЭС"]?.length ? (
          <Box sx={{ mt: 1 }}>
            <Divider sx={{ my: 1 }} />
            <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={1}>
              {task.meta["КЭС"].map((raw) => {
                const code = raw.split(" ")[0] || raw;
                return (
                  <Chip
                    key={raw}
                    size="small"
                    label={code}
                    variant="outlined"
                    clickable={Boolean(onKesClick)}
                    onClick={
                      onKesClick
                        ? (event) => onKesClick(raw, event.currentTarget as HTMLElement)
                        : undefined
                    }
                  />
                );
              })}
            </Stack>
          </Box>
        ) : null}
      </CardContent>

      <Drawer anchor="right" open={Boolean(drawerType)} onClose={() => setDrawerType(null)}>
        <Box
          sx={{
            width: { xs: "100vw", sm: 520 },
            p: 2,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              {drawerType ? SOLUTION_TYPE_LABELS[drawerType] : "Решения"}
            </Typography>
            <IconButton aria-label="Закрыть" onClick={() => setDrawerType(null)}>
              <CloseIcon />
            </IconButton>
          </Stack>

          {canEdit && onSolutionAdded && drawerType ? (
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => handleAddSolution(drawerType)}
            >
              Добавить решение
            </Button>
          ) : null}

          <Divider />

          <Box sx={{ flex: 1, overflow: "auto" }}>
            {activeSolutions.length ? (
              <Stack spacing={2}>
                {activeSolutions.map((solution, index) => (
                  <Box key={solution.id ?? `${solution.type}-${index}`}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                      <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
                        {solution.title || `Решение ${solution.num ?? index + 1}`}
                      </Typography>
                      {canEdit && onSolutionUpdated ? (
                        <IconButton
                          size="small"
                          aria-label="Редактировать решение"
                          onClick={() => handleEditSolution(solution)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      ) : null}
                    </Stack>
                    {solution.created_at ? (
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                        {solution.created_at}
                      </Typography>
                    ) : null}
                    <MarkdownRenderer markdown={solution.body} />
                  </Box>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Пока нет решений этого типа.
              </Typography>
            )}
          </Box>
        </Box>
      </Drawer>

      {canEdit && onAnswerSaved ? (
        <AnswerEditorDialog
          open={answerDialogOpen}
          task={task}
          onClose={() => setAnswerDialogOpen(false)}
          onSaved={onAnswerSaved}
        />
      ) : null}

      {canEdit && onSolutionAdded ? (
        <SolutionAddDialog
          open={solutionDialogOpen}
          task={task}
          defaultType={solutionDialogType}
          solution={solutionDialogSolution}
          onClose={() => setSolutionDialogOpen(false)}
          onSaved={onSolutionAdded}
          onUpdated={onSolutionUpdated}
        />
      ) : null}
    </Card>
  );
}
