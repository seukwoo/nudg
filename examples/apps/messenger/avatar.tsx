export function Avatar({ name, color, small }: { name: string; color: string; small?: boolean }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
  return (
    <span className={small ? "avatar small" : "avatar"} style={{ background: color }} aria-hidden="true">
      {initials}
    </span>
  );
}
