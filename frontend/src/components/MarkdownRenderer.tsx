import { MathJax, MathJaxContext } from "better-react-mathjax";
import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { Box, Link, Typography } from "@mui/material";

const mathJaxConfig = {
  options: {
    renderActions: {
      addMenu: [],
    },
  },
  tex: {
    inlineMath: [
      ["$", "$"],
      ["\\(", "\\)"],
    ],
    displayMath: [
      ["$$", "$$"],
      ["\\[", "\\]"],
    ],
    processEscapes: true,
  },
  loader: { load: ["input/tex", "input/mml", "output/chtml"] },
};

interface Props {
  markdown: string;
  inline?: boolean;
}

export function MarkdownRenderer({ markdown, inline = false }: Props) {
  const components = {
    p: ({ children }: { children: React.ReactNode }) =>
      inline ? (
        <Typography component="span" variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
          {children}
        </Typography>
      ) : (
        <Typography
          variant="body1"
          sx={{ whiteSpace: "pre-wrap", m: 0, mb: 1, "&:last-child": { mb: 0 } }}
        >
          {children}
        </Typography>
      ),
    strong: ({ children }: { children: React.ReactNode }) => (
      <Typography component="span" fontWeight={700}>
        {children}
      </Typography>
    ),
    em: ({ children }: { children: React.ReactNode }) => (
      <Typography component="span" fontStyle="italic">
        {children}
      </Typography>
    ),
    a: ({ children, href }: { children: React.ReactNode; href?: string }) => (
      <Link href={href} target="_blank" rel="noreferrer" underline="hover">
        {children}
      </Link>
    ),
    img: ({ src, alt }: { src?: string; alt?: string }) => (
      <img
        src={src}
        alt={alt}
        style={{ maxWidth: "100%", display: "block", margin: "8px 0" }}
        loading="lazy"
      />
    ),
    table: ({ children }: { children: React.ReactNode }) => (
      <Box sx={{ overflowX: "auto", my: 1 }}>
        <Box
          component="table"
          sx={{
            borderCollapse: "collapse",
            width: "100%",
            "& th, & td": { border: "1px solid", borderColor: "divider", px: 1, py: 0.5 },
            "& th": { backgroundColor: "action.hover", fontWeight: 700, textAlign: "center" },
          }}
        >
          {children}
        </Box>
      </Box>
    ),
  };

  return (
    <MathJaxContext version={3} config={mathJaxConfig}>
      <MathJax dynamic>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={components as never}
        >
          {markdown}
        </ReactMarkdown>
      </MathJax>
    </MathJaxContext>
  );
}
