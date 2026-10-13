/** The Skillpack mark: three strokes in the brand's orange → amber ramp. */
export const BRAND_MARK_STROKES = [
  { d: "M70,22 H37 A9 9 0 0 0 28,31 V41", color: "#EA580C" },
  { d: "M28,41 A9 9 0 0 0 37,50 H63 A9 9 0 0 1 72,59", color: "#F59E0B" },
  { d: "M72,59 V69 A9 9 0 0 1 63,78 H30", color: "#FBBF24" },
] as const;

export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg className={className ? `lp-mark ${className}` : "lp-mark"} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {BRAND_MARK_STROKES.map((stroke) => (
        <path key={stroke.d} d={stroke.d} stroke={stroke.color} />
      ))}
    </svg>
  );
}
