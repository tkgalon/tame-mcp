const TYPES: Record<string, string> = { pdf: "pdf", docx: "docx", md: "md", markdown: "md", txt: "txt" };

// Short coloured file type tag from the file name, like the PDF and DOCX chips on the landing page
export function fileType(name: string): { label: string; className: string } {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPES[extension] ?? "txt";
  return { label: type.toUpperCase(), className: `ft ${type}` };
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
