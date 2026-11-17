// Decides which renderer shows a file, from its name and (optional) MIME
// type. The extension wins when both are present and they disagree, because
// storage often reports `application/octet-stream` for everything.

export type FileKind =
  | "pdf"
  | "word"
  | "spreadsheet"
  | "csv"
  | "presentation"
  | "image"
  | "svg"
  | "markdown"
  | "text"
  | "code"
  | "html"
  | "video"
  | "audio"
  | "archive"
  | "model3d"
  | "unknown";

export type DetectedFile = {
  kind: FileKind;
  /** Lower-case extension without the dot, or "" when the name has none. */
  extension: string;
  /** Highlighter language for `code` (and `text` that has one), else undefined. */
  language?: string;
};

const BY_EXTENSION: Record<string, FileKind> = {
  pdf: "pdf",
  docx: "word",
  docm: "word",
  dotx: "word",
  xlsx: "spreadsheet",
  xlsm: "spreadsheet",
  xlsb: "spreadsheet",
  xls: "spreadsheet",
  ods: "spreadsheet",
  csv: "csv",
  tsv: "csv",
  pptx: "presentation",
  ppsx: "presentation",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  apng: "image",
  bmp: "image",
  ico: "image",
  svg: "svg",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  txt: "text",
  log: "text",
  ini: "text",
  cfg: "text",
  conf: "text",
  env: "text",
  html: "html",
  htm: "html",
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  ogv: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  oga: "audio",
  m4a: "audio",
  aac: "audio",
  flac: "audio",
  opus: "audio",
  zip: "archive",
  stl: "model3d",
  obj: "model3d",
  glb: "model3d",
  gltf: "model3d",
};

/** Extension → highlighter language id for code and structured data. */
const CODE_LANGUAGES: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  ps1: "powershell",
  sql: "sql",
  css: "css",
  scss: "scss",
  less: "less",
  vue: "vue",
  svelte: "svelte",
  json: "json",
  jsonc: "jsonc",
  ndjson: "json",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  diff: "diff",
  patch: "diff",
  dockerfile: "dockerfile",
  graphql: "graphql",
  gql: "graphql",
  lua: "lua",
  dart: "dart",
  r: "r",
};

const BY_MIME: Array<[RegExp, FileKind]> = [
  [/^application\/pdf$/, "pdf"],
  [
    /^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\./,
    "word",
  ],
  [
    /^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\./,
    "spreadsheet",
  ],
  [/^application\/vnd\.ms-excel/, "spreadsheet"],
  [/^application\/vnd\.oasis\.opendocument\.spreadsheet$/, "spreadsheet"],
  [
    /^application\/vnd\.openxmlformats-officedocument\.presentationml\./,
    "presentation",
  ],
  [/^text\/(csv|tab-separated-values)$/, "csv"],
  [/^image\/svg\+xml$/, "svg"],
  [/^image\//, "image"],
  [/^video\//, "video"],
  [/^audio\//, "audio"],
  [/^text\/markdown$/, "markdown"],
  [/^text\/html$/, "html"],
  [/^application\/(x-)?zip(-compressed)?$/, "archive"],
  [/^model\//, "model3d"],
  [/^application\/(json|xml|x-yaml|yaml|javascript|typescript|sql)$/, "code"],
  [/^text\//, "text"],
];

export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  if (base.toLowerCase() === "dockerfile") return "dockerfile";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function detectFileType(file: {
  name: string;
  mimeType?: string | null;
}): DetectedFile {
  const extension = fileExtension(file.name);
  const language = CODE_LANGUAGES[extension];
  if (language) return { kind: "code", extension, language };
  const byExtension = BY_EXTENSION[extension];
  if (byExtension) return { kind: byExtension, extension };
  const mime = (file.mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  for (const [pattern, kind] of BY_MIME) {
    if (pattern.test(mime)) return { kind, extension };
  }
  return { kind: "unknown", extension };
}
