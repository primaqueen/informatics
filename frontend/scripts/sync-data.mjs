import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, "..", "..");
const frontend = path.resolve(__dirname, "..");
const srcFile = path.join(root, "tasks_clean.jsonl");
const dstFile = path.join(frontend, "public", "tasks_clean.jsonl");
const srcAssets = path.join(root, "assets");
const dstAssets = path.join(frontend, "public", "assets");

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

copyFile(srcFile, dstFile);
copyDir(srcAssets, dstAssets);
