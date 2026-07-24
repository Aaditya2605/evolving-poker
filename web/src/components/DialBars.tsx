import { useEffect, useRef, useState } from "react";
import type { DialName, Strategy } from "../../../shared/types";
import { DIALS } from "../../../shared/types";
import { dialLabel, fmtDial } from "../lib/format";

interface Props {
  strategy: Strategy;
  color: string;
  compact?: boolean;
}

type PulseMap = Record<DialName, number>;

const NO_PULSE: PulseMap = { aggression: 0, bluffRate: 0, callThreshold: 0 };

export function DialBars({ strategy, color, compact = false }: Props) {
  const previous = useRef<Strategy>(strategy);
  const [pulse, setPulse] = useState<PulseMap>(NO_PULSE);

  useEffect(() => {
    const moved = DIALS.filter(
      (dial) => Math.abs(strategy[dial] - previous.current[dial]) > 1e-6,
    );
    previous.current = strategy;
    if (moved.length === 0) return;
    setPulse((current) => {
      const next: PulseMap = { ...current };
      for (const dial of moved) next[dial] = current[dial] + 1;
      return next;
    });
  }, [strategy]);

  return (
    <div className={`dials${compact ? " dials--compact" : ""}`}>
      {DIALS.map((dial) => {
        const value = Math.max(0, Math.min(1, strategy[dial]));
        return (
          <div className="dial" key={dial}>
            <span className="dial__label">{compact ? dial.slice(0, 3) : dialLabel(dial)}</span>
            <div className="dial__track">
              <div
                className="dial__fill"
                style={{ width: `${value * 100}%`, background: color }}
              />
              {pulse[dial] > 0 ? (
                <div className="dial__flash" key={`${dial}-${pulse[dial]}`} />
              ) : null}
            </div>
            <span className="dial__value mono">{fmtDial(strategy[dial])}</span>
          </div>
        );
      })}
    </div>
  );
}
