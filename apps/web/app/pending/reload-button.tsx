"use client";

export function ReloadButton() {
  return (
    <button className="btn p" type="button" onClick={() => window.location.reload()}>
      Reload
    </button>
  );
}
