import { CopyCodeButton } from "./CopyCodeButton";

/** A fenced code block with its language and a copy button; the code itself stays server-rendered. */
export function CodeBlock({ language, children }: { language: string | null; children?: React.ReactNode }) {
  return (
    <div className="v10-code" data-code-block="">
      <div className="v10-code__bar">
        <span className="v10-code__lang">{language ?? "text"}</span>
        <CopyCodeButton />
      </div>
      <pre>{children}</pre>
    </div>
  );
}
