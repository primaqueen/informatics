import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const overridesDir = path.join(__dirname, "content", "tasks");
const overridesIndexFile = path.join(__dirname, "public", "task_overrides.json");
const answersSourceFile = path.join(__dirname, "content", "answers.json");
const answersIndexFile = path.join(__dirname, "public", "answers.json");
const solutionsDir = path.join(__dirname, "content", "solutions");
const solutionsIndexFile = path.join(__dirname, "public", "solutions_index.json");
const tasksSourceFile = path.join(__dirname, "..", "tasks.jsonl");

const solutionTypes = ["analytical", "program", "excel", "other"] as const;
type SolutionType = (typeof solutionTypes)[number];

let sourceQuestionHtmlById: Map<string, string> | null = null;
let sourceQuestionHtmlLoadError: string | null = null;

function isValidInternalId(value: string): boolean {
  return /^[0-9a-f]{6}$/i.test(value);
}

function normalizeMarkdownBody(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  const trimmedEnd = text.trimEnd();
  const withoutLeadingNewlines = trimmedEnd.replace(/^\n+/, "");
  return withoutLeadingNewlines ? withoutLeadingNewlines + "\n" : "";
}

function normalizeAnswerValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeSolutionType(value: unknown): SolutionType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (solutionTypes as readonly string[]).includes(normalized) ? (normalized as SolutionType) : null;
}

function readAnswersFile(): Record<string, string | null> {
  if (!fs.existsSync(answersSourceFile)) return {};
  try {
    const raw = fs.readFileSync(answersSourceFile, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, string | null> = {};
    Object.entries(parsed ?? {}).forEach(([key, value]) => {
      const normalizedKey = key.toUpperCase();
      if (!isValidInternalId(normalizedKey)) return;
      result[normalizedKey] = normalizeAnswerValue(value);
    });
    return result;
  } catch {
    return {};
  }
}

function writeAnswersIndexFile(): Record<string, string | null> {
  const answers = readAnswersFile();
  fs.mkdirSync(path.dirname(answersIndexFile), { recursive: true });
  fs.writeFileSync(answersIndexFile, JSON.stringify(answers, null, 2) + "\n", "utf8");
  return answers;
}

interface SolutionIndexEntry {
  id: string;
  type: SolutionType;
  title?: string;
  created_at?: string;
  body: string;
  meta?: Record<string, unknown>;
  file?: string;
  num?: number;
}

function buildSolutionsIndex(srcDir: string): Record<string, SolutionIndexEntry[]> {
  const index: Record<string, SolutionIndexEntry[]> = {};
  if (!fs.existsSync(srcDir)) return index;

  const dirs = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const dirEntry of dirs) {
    if (!dirEntry.isDirectory()) continue;
    const internalId = dirEntry.name.toUpperCase();
    if (!isValidInternalId(internalId)) continue;

    const dirPath = path.join(srcDir, dirEntry.name);
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    const solutions: SolutionIndexEntry[] = [];

    for (const fileEntry of files) {
      if (!fileEntry.isFile()) continue;
      if (!fileEntry.name.toLowerCase().endsWith(".mdx")) continue;

      const match = fileEntry.name.match(/^solution_([a-z]+)_(\d+)\.mdx$/i);
      if (!match) continue;
      const typeFromName = normalizeSolutionType(match[1]);
      if (!typeFromName) continue;
      const num = Number(match[2]);

      const fullPath = path.join(dirPath, fileEntry.name);
      const raw = fs.readFileSync(fullPath, "utf8");
      // Старая версия писала "\\n" как текст, из-за чего body не читался.
      const normalizedRaw = raw.startsWith("---\\n") ? raw.replace(/\\n/g, "\n") : raw;
      const parsed = matter(normalizedRaw);
      const meta = (parsed.data ?? {}) as Record<string, unknown>;
      const body = typeof parsed.content === "string" ? parsed.content : "";

      const typeFromMeta = normalizeSolutionType(meta.type);
      const type = typeFromMeta ?? typeFromName;

      solutions.push({
        id: path.basename(fileEntry.name, path.extname(fileEntry.name)),
        type,
        title: typeof meta.title === "string" ? meta.title.trim() : undefined,
        created_at: typeof meta.created_at === "string" ? meta.created_at.trim() : undefined,
        body: normalizeMarkdownBody(body),
        meta,
        file: fileEntry.name,
        num: Number.isFinite(num) ? num : undefined,
      });
    }

    solutions.sort((a, b) => {
      if (a.type === b.type) {
        const numA = a.num ?? 0;
        const numB = b.num ?? 0;
        return numA - numB;
      }
      return a.type.localeCompare(b.type);
    });

    index[internalId] = solutions;
  }

  return index;
}

function writeSolutionsIndexFile(): Record<string, SolutionIndexEntry[]> {
  const index = buildSolutionsIndex(solutionsDir);
  fs.mkdirSync(path.dirname(solutionsIndexFile), { recursive: true });
  fs.writeFileSync(solutionsIndexFile, JSON.stringify(index, null, 2) + "\n", "utf8");
  return index;
}

function buildOverridesIndex(srcDir: string): Record<string, unknown> {
  const index: Record<string, unknown> = {};
  if (!fs.existsSync(srcDir)) return index;

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".mdx")) continue;

    const internalId = path.basename(entry.name, path.extname(entry.name)).toUpperCase();
    if (!isValidInternalId(internalId)) continue;

    const fullPath = path.join(srcDir, entry.name);
    const raw = fs.readFileSync(fullPath, "utf8");
    const parsed = matter(raw);
    const data = parsed.data ?? {};
    const content = typeof parsed.content === "string" ? parsed.content : "";

    index[internalId] = {
      question_md: normalizeMarkdownBody(content),
      answer_type: (data as Record<string, unknown>).answer_type ?? undefined,
      hint:
        typeof (data as Record<string, unknown>).hint === "string"
          ? String((data as Record<string, unknown>).hint).trimEnd()
          : (data as Record<string, unknown>).hint ?? undefined,
      options: (data as Record<string, unknown>).options ?? undefined,
    };
  }

  return index;
}

function writeOverridesIndexFile(): Record<string, unknown> {
  const index = buildOverridesIndex(overridesDir);
  fs.mkdirSync(path.dirname(overridesIndexFile), { recursive: true });
  fs.writeFileSync(overridesIndexFile, JSON.stringify(index, null, 2) + "\n", "utf8");
  return index;
}

function getSourceQuestionHtmlIndex(): Map<string, string> {
  if (sourceQuestionHtmlById) return sourceQuestionHtmlById;
  if (sourceQuestionHtmlLoadError) throw new Error(sourceQuestionHtmlLoadError);

  const map = new Map<string, string>();
  try {
    if (!fs.existsSync(tasksSourceFile)) {
      sourceQuestionHtmlById = map;
      return map;
    }

    const raw = fs.readFileSync(tasksSourceFile, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line) as Record<string, unknown>;
        const internalId = typeof item.internal_id === "string" ? item.internal_id.toUpperCase() : "";
        if (!isValidInternalId(internalId)) continue;
        const questionHtml = typeof item.question_html === "string" ? item.question_html : "";
        map.set(internalId, questionHtml);
      } catch {
        // ignore
      }
    }

    sourceQuestionHtmlById = map;
    return map;
  } catch (e) {
    sourceQuestionHtmlLoadError = e instanceof Error ? e.message : String(e);
    throw new Error(sourceQuestionHtmlLoadError);
  }
}

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    https:
      process.env.VITE_HTTPS === "1"
        ? {
            cert: process.env.VITE_HTTPS_CERT ? fs.readFileSync(process.env.VITE_HTTPS_CERT) : undefined,
            key: process.env.VITE_HTTPS_KEY ? fs.readFileSync(process.env.VITE_HTTPS_KEY) : undefined,
          }
        : undefined,
  },
  plugins: [
    react(),
    {
      name: "task-overrides-admin",
      configureServer(server) {
        writeOverridesIndexFile();
        writeAnswersIndexFile();
        writeSolutionsIndexFile();
        server.middlewares.use(async (req, res, next) => {
          if (!req.url) return next();
          const url = new URL(req.url, "http://localhost");
          if (url.pathname.startsWith("/__admin/task-source/")) {
            const rawId = decodeURIComponent(url.pathname.replace("/__admin/task-source/", "")).trim();
            const internalId = rawId.toUpperCase();
            if (!isValidInternalId(internalId)) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: "Некорректный internal_id" }));
              return;
            }

            if (req.method !== "GET") {
              res.statusCode = 405;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: "Метод не поддерживается" }));
              return;
            }

            try {
              const index = getSourceQuestionHtmlIndex();
              if (!index.has(internalId)) {
                res.statusCode = 404;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ exists: false }));
                return;
              }

              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ exists: true, question_html: index.get(internalId) ?? "" }));
              return;
            } catch (e) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
              return;
            }
          }

          if (url.pathname.startsWith("/__admin/answer/")) {
            const rawId = decodeURIComponent(url.pathname.replace("/__admin/answer/", "")).trim();
            const internalId = rawId.toUpperCase();
            if (!isValidInternalId(internalId)) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: "Некорректный internal_id" }));
              return;
            }

            if (req.method === "GET") {
              const answers = readAnswersFile();
              if (!(internalId in answers)) {
                res.statusCode = 404;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ exists: false }));
                return;
              }

              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ exists: true, answer: answers[internalId] ?? null }));
              return;
            }

            if (req.method === "PUT") {
              const chunks: Buffer[] = [];
              await new Promise<void>((resolve, reject) => {
                req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
                req.on("end", () => resolve());
                req.on("error", (err) => reject(err));
              });

              const rawBody = Buffer.concat(chunks).toString("utf8");
              let payload: unknown;
              try {
                payload = JSON.parse(rawBody);
              } catch {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: "Некорректный JSON" }));
                return;
              }

              const obj = payload as Record<string, unknown>;
              const answer = normalizeAnswerValue(obj.answer);
              const answers = readAnswersFile();
              answers[internalId] = answer;

              fs.mkdirSync(path.dirname(answersSourceFile), { recursive: true });
              fs.writeFileSync(answersSourceFile, JSON.stringify(answers, null, 2) + "\n", "utf8");
              const index = writeAnswersIndexFile();

              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: true, answer: index[internalId] ?? null }));
              return;
            }

            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Метод не поддерживается" }));
            return;
          }

          if (url.pathname.startsWith("/__admin/solutions/")) {
            const rawId = decodeURIComponent(url.pathname.replace("/__admin/solutions/", "")).trim();
            const internalId = rawId.toUpperCase();
            if (!isValidInternalId(internalId)) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: "Некорректный internal_id" }));
              return;
            }

            if (req.method === "GET") {
              const index = buildSolutionsIndex(solutionsDir);
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ solutions: index[internalId] ?? [] }));
              return;
            }

          if (req.method === "POST") {
              const chunks: Buffer[] = [];
              await new Promise<void>((resolve, reject) => {
                req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
                req.on("end", () => resolve());
                req.on("error", (err) => reject(err));
              });

              const rawBody = Buffer.concat(chunks).toString("utf8");
              let payload: unknown;
              try {
                payload = JSON.parse(rawBody);
              } catch {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: "Некорректный JSON" }));
                return;
              }

              const obj = payload as Record<string, unknown>;
              const type = normalizeSolutionType(obj.type);
              const body = typeof obj.body === "string" ? obj.body : "";
              const title = typeof obj.title === "string" ? obj.title.trim() : "";
              const frontmatter = (obj.frontmatter as Record<string, unknown>) ?? {};

              if (!type) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: "Некорректный тип решения" }));
                return;
              }

              if (!body.trim()) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: "Пустое тело решения" }));
                return;
              }

              const dirPath = path.join(solutionsDir, internalId);
              fs.mkdirSync(dirPath, { recursive: true });

              const existing = fs.readdirSync(dirPath, { withFileTypes: true });
              const nums = existing
                .filter((entry) => entry.isFile())
                .map((entry) => entry.name.match(new RegExp(`^solution_${type}_(\\\\d+)\\\\.mdx$`, "i")))
                .filter((match): match is RegExpMatchArray => Boolean(match))
                .map((match) => Number(match[1]))
                .filter((num) => Number.isFinite(num));

              const nextNum = nums.length ? Math.max(...nums) + 1 : 1;
              let candidateNum = nextNum;
              let fileName = `solution_${type}_${candidateNum}.mdx`;
              let filePath = path.join(dirPath, fileName);
              // На всякий случай избегаем перезаписи при сбое нумерации.
              while (fs.existsSync(filePath)) {
                candidateNum += 1;
                fileName = `solution_${type}_${candidateNum}.mdx`;
                filePath = path.join(dirPath, fileName);
              }

              const payloadFrontmatter: Record<string, unknown> = {
                ...frontmatter,
                type,
              };
              if (title) payloadFrontmatter.title = title;

              const yaml = YAML.stringify(payloadFrontmatter).trim();
              const normalizedBody = body.trimEnd() + "\n";
              const mdx = `---\n${yaml}\n---\n\n${normalizedBody}`;
              fs.writeFileSync(filePath, mdx, "utf8");

              const index = writeSolutionsIndexFile();
              const created =
                index[internalId]?.find(
                  (item) => item.id === path.basename(fileName, path.extname(fileName)),
                ) ?? null;

              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, solution: created }));
            return;
          }

          if (req.method === "PUT") {
            const chunks: Buffer[] = [];
            await new Promise<void>((resolve, reject) => {
              req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
              req.on("end", () => resolve());
              req.on("error", (err) => reject(err));
            });

            const rawBody = Buffer.concat(chunks).toString("utf8");
            let payload: unknown;
            try {
              payload = JSON.parse(rawBody);
            } catch {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: "Некорректный JSON" }));
              return;
            }

            const obj = payload as Record<string, unknown>;
            const solutionId = typeof obj.id === "string" ? obj.id.trim() : "";
            if (!/^solution_[a-z]+_\\d+$/i.test(solutionId)) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: "Некорректный id решения" }));
              return;
            }

            const type = normalizeSolutionType(obj.type);
            const body = typeof obj.body === "string" ? obj.body : "";
            const title = typeof obj.title === "string" ? obj.title.trim() : "";
            const frontmatter = (obj.frontmatter as Record<string, unknown>) ?? {};

            if (!type) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: "Некорректный тип решения" }));
              return;
            }

            if (!body.trim()) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: "Пустое тело решения" }));
              return;
            }

            const idMatch = solutionId.match(/^solution_([a-z]+)_(\\d+)$/i);
            const typeFromName = idMatch ? normalizeSolutionType(idMatch[1]) : null;
            if (typeFromName && type !== typeFromName) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: "Нельзя менять тип решения у существующего файла" }));
              return;
            }

            const dirPath = path.join(solutionsDir, internalId);
            const filePath = path.join(dirPath, `${solutionId}.mdx`);
            if (!fs.existsSync(filePath)) {
              res.statusCode = 404;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: "Файл решения не найден" }));
              return;
            }

            const rawExisting = fs.readFileSync(filePath, "utf8");
            const normalizedExisting = rawExisting.startsWith("---\\n")
              ? rawExisting.replace(/\\n/g, "\n")
              : rawExisting;
            const parsedExisting = matter(normalizedExisting);
            const existingMeta = (parsedExisting.data ?? {}) as Record<string, unknown>;

            const payloadFrontmatter: Record<string, unknown> = {
              ...existingMeta,
              ...frontmatter,
              type,
            };
            if (title) {
              payloadFrontmatter.title = title;
            } else {
              delete payloadFrontmatter.title;
            }

            const yaml = YAML.stringify(payloadFrontmatter).trim();
            const normalizedBody = body.trimEnd() + "\n";
            const mdx = `---\n${yaml}\n---\n\n${normalizedBody}`;
            fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(filePath, mdx, "utf8");

            const index = writeSolutionsIndexFile();
            const updated =
              index[internalId]?.find(
                (item) => item.id === path.basename(solutionId, path.extname(solutionId)),
              ) ?? null;

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, solution: updated }));
            return;
          }

          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "Метод не поддерживается" }));
          return;
        }

          if (!url.pathname.startsWith("/__admin/task/")) return next();

          const rawId = decodeURIComponent(url.pathname.replace("/__admin/task/", "")).trim();
          const internalId = rawId.toUpperCase();
          if (!isValidInternalId(internalId)) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Некорректный internal_id" }));
            return;
          }

          const filePath = path.join(overridesDir, `${internalId}.mdx`);

          if (req.method === "GET") {
            if (!fs.existsSync(filePath)) {
              res.statusCode = 404;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ exists: false }));
              return;
            }

            const raw = fs.readFileSync(filePath, "utf8");
            const parsed = matter(raw);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                exists: true,
                frontmatter: parsed.data ?? {},
                body: typeof parsed.content === "string" ? parsed.content : "",
              }),
            );
            return;
          }

          if (req.method === "PUT") {
            const chunks: Buffer[] = [];
            await new Promise<void>((resolve, reject) => {
              req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
              req.on("end", () => resolve());
              req.on("error", (err) => reject(err));
            });

            const rawBody = Buffer.concat(chunks).toString("utf8");
            let payload: unknown;
            try {
              payload = JSON.parse(rawBody);
            } catch {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: "Некорректный JSON" }));
              return;
            }

            const obj = payload as Record<string, unknown>;
            const frontmatter = (obj.frontmatter as Record<string, unknown>) ?? {};
            const body = typeof obj.body === "string" ? obj.body : "";

            fs.mkdirSync(overridesDir, { recursive: true });
            const yaml = YAML.stringify(frontmatter).trim();
            const normalizedBody = body.trimEnd() + "\n";
            const mdx = `---\n${yaml}\n---\n\n${normalizedBody}`;
            fs.writeFileSync(filePath, mdx, "utf8");

            const index = writeOverridesIndexFile();
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, override: index[internalId] ?? null }));
            return;
          }

          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "Метод не поддерживается" }));
        });
      },
    },
  ],
  preview: {
    port: 4173,
  },
});
