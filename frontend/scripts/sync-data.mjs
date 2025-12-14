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

function normalizeMarkdownBody(value) {
  const text = typeof value === "string" ? value : "";
  const trimmedEnd = text.trimEnd();
  const withoutLeadingNewlines = trimmedEnd.replace(/^\n+/, "");
  return withoutLeadingNewlines ? withoutLeadingNewlines + "\n" : "";
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

copyFile(srcFile, dstFile);
copyFile(srcTaskNumbers, dstTaskNumbers);
copyDir(srcAssets, dstAssets);
buildOverridesIndex(overridesDir, overridesIndexFile);
