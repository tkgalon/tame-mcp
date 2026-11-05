"use client";

import { CenterScreen } from "../components/center-screen";
import { TameMark } from "../components/tame-mark";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <CenterScreen>
      <TameMark className="mark rise" eyes="#E5484D" />
      <div className="rise d1" style={{ display: "grid", gap: 8 }}>
        <h1>
          Something <span className="tone">went wrong</span>
        </h1>
        <p className="lead" style={{ fontSize: 17 }}>
          The action could not be completed. Try again, and check that the file or item still exists.
        </p>
      </div>
      <div
        className="rise d2"
        style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}
      >
        <button className="btn p lg" type="button" onClick={reset}>
          Try again
        </button>
        <a className="btn lg" href="/">
          Back to overview
        </a>
      </div>
    </CenterScreen>
  );
}
