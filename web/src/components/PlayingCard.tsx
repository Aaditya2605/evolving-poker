import { parseCard } from "../lib/cards";

interface Props {
  code: string;
  size?: "sm" | "md" | "lg";
  index?: number;
  dimmed?: boolean;
}

export function PlayingCard({ code, size = "md", index = 0, dimmed }: Props) {
  const { rank, suit, red } = parseCard(code);
  const className = [
    "card",
    `card--${size}`,
    red ? "card--red" : "card--black",
    dimmed ? "card--dimmed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      style={{ animationDelay: `${index * 90}ms` }}
      aria-label={`${rank} ${suit}`}
    >
      <span className="card__rank">{rank}</span>
      <span className="card__suit">{suit}</span>
    </div>
  );
}

export function CardSlot() {
  return <div className="card card--slot" aria-hidden="true" />;
}
