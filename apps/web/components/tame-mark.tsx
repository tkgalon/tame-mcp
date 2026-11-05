type Props = { className?: string; eyes?: string; dim?: boolean };

// The agent device from the landing hero, shrunk to a mark. The eye colour carries the state.
export function TameMark({ className, eyes = "var(--acc)", dim = false }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="3" width="20" height="18" rx="5" fill="#2C2F33" />
      <rect x="5" y="7" width="14" height="8" rx="3" fill="#0E0F10" />
      {dim ? (
        <>
          <rect x="8" y="10.6" width="2.4" height="1.2" rx=".6" fill="#8C9096" />
          <rect x="13.6" y="10.6" width="2.4" height="1.2" rx=".6" fill="#8C9096" />
        </>
      ) : (
        <>
          <rect x="8" y="9.5" width="2.4" height="3.4" rx="1.2" fill={eyes} />
          <rect x="13.6" y="9.5" width="2.4" height="3.4" rx="1.2" fill={eyes} />
        </>
      )}
    </svg>
  );
}
