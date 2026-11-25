import { Fragment } from "react";

/**
 * Hebrew / Arabic text with Latin words and numbers inside ("בדף ה-QR", "ל-15 דקות"): each Latin or
 * number run is isolated (`<bdi dir="ltr">`) so the browser never reorders it with the words around it.
 */
const LTR_RUN = /([A-Za-z0-9](?:[A-Za-z0-9.:/]*[A-Za-z0-9])?)/;

/** The text split into plain parts and Latin/number runs (pure, for tests). */
export function splitLtrRuns(text: string): { text: string; ltr: boolean }[] {
  return text
    .split(LTR_RUN)
    .map((part, i) => ({ text: part, ltr: i % 2 === 1 }))
    .filter((p) => p.text !== "");
}

export function BidiText({ text }: { text: string }) {
  return (
    <>
      {splitLtrRuns(text).map((p, i) =>
        p.ltr ? (
          <bdi key={i} dir="ltr">
            {p.text}
          </bdi>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        )
      )}
    </>
  );
}
