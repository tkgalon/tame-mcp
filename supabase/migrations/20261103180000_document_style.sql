-- Formatting measured during extraction (fonts, colors, boxes, header and footer), shown to agents next to the text.
-- Null for plain text, Markdown and documents read before the style summary existed.
alter table public.documents
  add column style jsonb check (style is null or jsonb_typeof(style) = 'object');
