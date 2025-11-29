export type AnswerType = "short_answer" | "single_choice" | "multiple_choice" | "unknown";

export interface Task {
  qid: string;
  suffix: string;
  guid: string;
  internal_id: string;
  hint: string;
  question_text: string;
  question_html_clean: string;
  question_md: string;
  images: Array<{ src: string; alt: string }>;
  attachments: Array<{ href: string; text: string }>;
  answer_type: AnswerType;
  options: Array<{ value: string; text: string }>;
  meta: {
    "КЭС": string[];
    "Тип ответа": string;
    internal_id: string;
  };
  page_index: number;
  index_on_page: number;
}
