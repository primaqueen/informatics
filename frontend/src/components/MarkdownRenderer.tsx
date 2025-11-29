import { MathJax, MathJaxContext } from "better-react-mathjax";
import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { Link, Typography } from "@mui/material";

const components = {
  p: ({ children }: { children: React.ReactNode }) => (
    <Typography variant="body1" paragraph sx={{ whiteSpace: "pre-wrap" }}>
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
};

const mathJaxConfig = {
  options: {
    renderActions: {
      addMenu: [],
    },
  },
  loader: { load: ["input/tex", "input/mml", "output/chtml"] },
};

interface Props {
  markdown: string;
}

export function MarkdownRenderer({ markdown }: Props) {
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
