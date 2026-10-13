/** Initial-letter avatar shared by the landing visuals and the portal demo. */
export function Avatar({ who, tone, sm }: { who: string; tone: string; sm?: boolean }) {
  return (
    <span className={"v5-avatar v5-avatar--" + tone + (sm ? " v5-avatar--sm" : "")} aria-hidden="true">
      {who[0]}
    </span>
  );
}
