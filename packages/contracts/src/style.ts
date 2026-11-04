import { z } from "zod";

export const MAX_STYLE_ENTRIES = 12;
export const MAX_STYLE_SAMPLE_CHARACTERS = 80;

const color = z.string().regex(/^#[0-9a-f]{6}$/);
const share = z.number().min(0).max(1);
const points = z.number().min(0).max(5000);
const sample = z
  .string()
  .max(MAX_STYLE_SAMPLE_CHARACTERS * 2)
  .nullable();
const alignment = z.enum(["left", "center", "right", "justify"]);

// Measured from the file without any model, so agents can see formatting that plain text loses
export const documentStyleSchema = z.strictObject({
  source: z.enum(["docx", "pdf"]),
  page: z
    .strictObject({
      widthPt: points,
      heightPt: points,
      marginsPt: z
        .strictObject({ top: points, right: points, bottom: points, left: points })
        .nullable()
        .describe("Exact for DOCX, the text area bounds for PDF"),
    })
    .nullable(),
  textStyles: z
    .array(
      z.strictObject({
        font: z.string().max(120).nullable(),
        sizePt: points.nullable(),
        bold: z.boolean(),
        italic: z.boolean(),
        color: color.nullable(),
        alignment: alignment.nullable(),
        share: share.describe("Fraction of the document's characters in this style"),
        sample: sample.describe("The first text written in this style"),
      }),
    )
    .max(MAX_STYLE_ENTRIES)
    .describe("Distinct text styles, most used first"),
  fills: z
    .array(
      z.strictObject({
        color,
        count: z.number().int().min(1),
        sample: sample.describe("Text inside the first box or shaded paragraph with this color"),
      }),
    )
    .max(MAX_STYLE_ENTRIES)
    .describe("Background colors of boxes, shaded paragraphs and table cells, not of images"),
  tables: z.number().int().min(0).nullable().describe("Null when the format does not mark tables, as in PDF"),
  images: z.number().int().min(0),
  rules: z.number().int().min(0).describe("Drawn lines, such as separators and table borders"),
  header: z.array(z.string().max(MAX_STYLE_SAMPLE_CHARACTERS * 2)).max(5),
  footer: z.array(z.string().max(MAX_STYLE_SAMPLE_CHARACTERS * 2)).max(5),
  pagesMeasured: z.number().int().min(0),
});
export type DocumentStyle = z.infer<typeof documentStyleSchema>;
