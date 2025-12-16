export type AnswerType = "short_answer" | "single_choice" | "multiple_choice" | "unknown";

export interface TaskOption {
  value: string;
  text: string;
}

export interface TaskOverride {
  answer_type?: AnswerType;
  hint?: string;
  options?: TaskOption[];
  question_md?: string;
}

export interface Task {
  qid: string;
  suffix: string;
  guid: string;
  internal_id: string;
  task_number: number | null;
  hint: string;
  question_text: string;
  question_html_clean: string;
  question_md: string;
  requires_attachments?: boolean;
  question_override_md?: string;
  has_override?: boolean;
  images: Array<{ src: string; alt: string }>;
  attachments: Array<{ href: string; text: string }>;
  answer_type: AnswerType;
  options: TaskOption[];
  meta: {
    "КЭС": string[];
    "Тип ответа": string;
    internal_id: string;
  };
  page_index: number;
  index_on_page: number;
}
