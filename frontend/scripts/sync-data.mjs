import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, "..", "..");
const frontend = path.resolve(__dirname, "..");
const srcFile = path.join(root, "tasks_clean.jsonl");
const dstFile = path.join(frontend, "public", "tasks_clean.jsonl");
const srcTaskNumbers = path.join(root, "internal_id_to_task_number.json");
const dstTaskNumbers = path.join(frontend, "public", "internal_id_to_task_number.json");
const srcAssets = path.join(root, "assets");
const dstAssets = path.join(frontend, "public", "assets");
const overridesDir = path.join(frontend, "content", "tasks");
const overridesIndexFile = path.join(frontend, "public", "task_overrides.json");
const answersSourceFile = path.join(frontend, "content", "answers.json");
const answersIndexFile = path.join(frontend, "public", "answers.json");
const solutionsDir = path.join(frontend, "content", "solutions");
const solutionsIndexFile = path.join(frontend, "public", "solutions_index.json");

const solutionTypes = ["analytical", "program", "excel", "other"];

function normalizeMarkdownBody(value) {
  const text = typeof value === "string" ? value : "";
  const trimmedEnd = text.trimEnd();
  const withoutLeadingNewlines = trimmedEnd.replace(/^\n+/, "");
  return withoutLeadingNewlines ? withoutLeadingNewlines + "\n" : "";
}

function normalizeAnswerValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeSolutionType(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return solutionTypes.includes(normalized) ? normalized : null;
}

function copyFile(src, dst) {
  if (!fs.existsSync(src)) {
    console.warn(`[sync-data] Файл не найден: ${src}`);
    return;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`[sync-data] Скопирован ${path.relative(frontend, dst)}`);
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) {
    console.warn(`[sync-data] Каталог не найден: ${src}`);
    return;
  }
  fs.mkdirSync(dst, { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
  console.log(`[sync-data] Скопирован каталог ${path.relative(frontend, dst)}`);
}

function buildOverridesIndex(srcDir, dstFilePath) {
  const index = {};
  if (!fs.existsSync(srcDir)) {
    fs.mkdirSync(path.dirname(dstFilePath), { recursive: true });
    fs.writeFileSync(dstFilePath, JSON.stringify(index, null, 2) + "\n", "utf8");
    console.log(`[sync-data] Оверрайды не найдены, записан пустой ${path.relative(frontend, dstFilePath)}`);
    return;
  }

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".mdx")) continue;

    const internalId = path.basename(entry.name, path.extname(entry.name)).toUpperCase();
    const fullPath = path.join(srcDir, entry.name);
    const raw = fs.readFileSync(fullPath, "utf8");
    const parsed = matter(raw);
    const data = parsed.data ?? {};
    const content = typeof parsed.content === "string" ? parsed.content : "";

    index[internalId] = {
      question_md: normalizeMarkdownBody(content),
      answer_type: data.answer_type ?? undefined,
      hint: typeof data.hint === "string" ? data.hint.trimEnd() : (data.hint ?? undefined),
      options: data.options ?? undefined,
    };
  }

  fs.mkdirSync(path.dirname(dstFilePath), { recursive: true });
  fs.writeFileSync(dstFilePath, JSON.stringify(index, null, 2) + "\n", "utf8");
  console.log(`[sync-data] Сгенерирован ${path.relative(frontend, dstFilePath)} (задач: ${Object.keys(index).length})`);
}

function readAnswersFile(srcFilePath) {
  if (!fs.existsSync(srcFilePath)) return {};
  try {
    const raw = fs.readFileSync(srcFilePath, "utf8");
    const parsed = JSON.parse(raw);
    const result = {};
    Object.entries(parsed ?? {}).forEach(([key, value]) => {
      const normalizedKey = String(key).toUpperCase();
      result[normalizedKey] = normalizeAnswerValue(value);
    });
    return result;
  } catch {
    return {};
  }
}

function writeAnswersIndexFile(srcFilePath, dstFilePath) {
  const answers = readAnswersFile(srcFilePath);
  fs.mkdirSync(path.dirname(dstFilePath), { recursive: true });
  fs.writeFileSync(dstFilePath, JSON.stringify(answers, null, 2) + "\n", "utf8");
  console.log(`[sync-data] Сгенерирован ${path.relative(frontend, dstFilePath)} (ответов: ${Object.keys(answers).length})`);
}

function buildSolutionsIndex(srcDir, dstFilePath) {
  const index = {};
  if (!fs.existsSync(srcDir)) {
    fs.mkdirSync(path.dirname(dstFilePath), { recursive: true });
    fs.writeFileSync(dstFilePath, JSON.stringify(index, null, 2) + "\n", "utf8");
    console.log(`[sync-data] Решения не найдены, записан пустой ${path.relative(frontend, dstFilePath)}`);
    return;
  }

  const dirs = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const dirEntry of dirs) {
    if (!dirEntry.isDirectory()) continue;
    const internalId = dirEntry.name.toUpperCase();
    const dirPath = path.join(srcDir, dirEntry.name);
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    const solutions = [];

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
      const parsed = matter(raw);
      const meta = parsed.data ?? {};
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

  fs.mkdirSync(path.dirname(dstFilePath), { recursive: true });
  fs.writeFileSync(dstFilePath, JSON.stringify(index, null, 2) + "\n", "utf8");
  console.log(`[sync-data] Сгенерирован ${path.relative(frontend, dstFilePath)} (задач: ${Object.keys(index).length})`);
}

copyFile(srcFile, dstFile);
copyFile(srcTaskNumbers, dstTaskNumbers);
copyDir(srcAssets, dstAssets);
buildOverridesIndex(overridesDir, overridesIndexFile);
writeAnswersIndexFile(answersSourceFile, answersIndexFile);
buildSolutionsIndex(solutionsDir, solutionsIndexFile);
