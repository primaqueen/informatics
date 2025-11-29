import {
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Box,
} from "@mui/material";
import React from "react";
import type { Task } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface Props {
  task: Task;
}

export function TaskCard({ task }: Props) {
  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Chip size="small" label={task.internal_id || task.qid} />
          {task.answer_type !== "short_answer" && (
            <Chip size="small" label={`Тип: ${task.answer_type}`} color="info" />
          )}
          {task.meta?.["Тип ответа"] && (
            <Chip size="small" label={task.meta["Тип ответа"]} variant="outlined" />
          )}
        </Stack>
        <MarkdownRenderer markdown={task.question_md} />
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
