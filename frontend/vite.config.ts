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
const tasksSourceFile = path.join(__dirname, "..", "tasks.jsonl");

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
  plugins: [
    react(),
    {
      name: "task-overrides-admin",
      configureServer(server) {
        writeOverridesIndexFile();
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
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 4173,
  },
});
