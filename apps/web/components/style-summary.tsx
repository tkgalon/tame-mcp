import type { DocumentStyle } from "@tame/contracts";

const percent = (share: number) => `${Math.round(share * 100)}%`;

export function StyleSummary({ style }: { style: DocumentStyle }) {
  const { page } = style;
  const counts = [
    style.tables !== null && `${style.tables} tables`,
    `${style.images} images`,
    `${style.rules} lines`,
  ].filter(Boolean);
  return (
    <div className="sty">
      {page && (
        <p className="meta">
          <span>
            Page {page.widthPt} × {page.heightPt} pt
          </span>
          {page.marginsPt && (
            <span>
              {style.source === "pdf" ? "text area from edges" : "margins"} {page.marginsPt.top} /{" "}
              {page.marginsPt.right} / {page.marginsPt.bottom} / {page.marginsPt.left} pt
            </span>
          )}
          {style.source === "pdf" && <span>{style.pagesMeasured} pages measured</span>}
        </p>
      )}
      <table>
        <caption>Text styles, most used first</caption>
        <thead>
          <tr>
            <th scope="col">Font</th>
            <th scope="col">Size</th>
            <th scope="col">Look</th>
            <th scope="col">Share</th>
            <th scope="col" className="hide-sm">
              First text
            </th>
          </tr>
        </thead>
        <tbody>
          {style.textStyles.map((text, index) => (
            <tr key={index}>
              <td>{text.font ?? "Unknown"}</td>
              <td>{text.sizePt === null ? "Default" : `${text.sizePt} pt`}</td>
              <td>
                {[text.bold && "bold", text.italic && "italic", text.color, text.alignment]
                  .filter(Boolean)
                  .join(", ")}
              </td>
              <td>{percent(text.share)}</td>
              <td className="hide-sm">{text.sample}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {style.fills.map((fill) => (
        <p key={fill.color} className="meta">
          <span>
            <i className="swatch" style={{ background: fill.color }} /> {fill.color} background, {fill.count}×
            {fill.sample && `, first with "${fill.sample}"`}
          </span>
        </p>
      ))}
      <p className="meta">
        <span>{counts.join(", ")}</span>
        {style.header.length > 0 && <span>Header: {style.header.join(" · ")}</span>}
        {style.footer.length > 0 && <span>Footer: {style.footer.join(" · ")}</span>}
      </p>
    </div>
  );
}
