import type { DocumentStyle } from "@tame/contracts";

const percent = (share: number) => `${Math.round(share * 100)}%`;

export function StyleSummary({ style }: { style: DocumentStyle }) {
  const { page } = style;
  return (
    <div className="style-summary">
      {page && (
        <p>
          Page {page.widthPt} × {page.heightPt} pt
          {page.marginsPt &&
            `, ${style.source === "pdf" ? "text area from edges" : "margins"} ${page.marginsPt.top} / ${page.marginsPt.right} / ${page.marginsPt.bottom} / ${page.marginsPt.left} pt`}
          {style.source === "pdf" && `, ${style.pagesMeasured} pages measured`}
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
            <th scope="col">First text</th>
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
              <td>{text.sample}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {style.fills.length > 0 && (
        <ul>
          {style.fills.map((fill) => (
            <li key={fill.color}>
              <span className="swatch" style={{ background: fill.color }} aria-hidden="true" /> {fill.color}{" "}
              background, {fill.count}×{fill.sample && `, first with "${fill.sample}"`}
            </li>
          ))}
        </ul>
      )}
      <p>
        {style.tables !== null && `${style.tables} tables, `}
        {style.images} images, {style.rules} lines
      </p>
      {style.header.length > 0 && <p>Header: {style.header.join(" · ")}</p>}
      {style.footer.length > 0 && <p>Footer: {style.footer.join(" · ")}</p>}
    </div>
  );
}
