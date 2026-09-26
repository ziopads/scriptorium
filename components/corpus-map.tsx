'use client';

import { useState } from 'react';

import type { MapPoint } from '@/lib/neighbours';

// Draws the corpus map (lib/neighbours.ts corpusMap). Client code only for
// hover: pointing at a work draws lines to its five nearest works, which are
// the real resemblances, where the positions are only an approximation of
// them. A focused work (?focus=) shows its lines until another is pointed at.
// A project (?project=) dims every work outside it.
//
// Ink only: a filled point is a Spanish text, an open one English, so the
// language the correction took out stays visible. Labels are placed in a fixed
// order and dropped where they would collide; every point names itself on
// hover and in the list under the map.

const W = 960;
const H = 640;
const PAD = 36;
const LABEL_RIGHT = 90;
const CHAR = 5.2; // rough width of a character at 9px

function who(p: MapPoint): string {
  return (p.author ?? p.editor ?? p.title).split(',')[0];
}

export function CorpusMap({
  points,
  focus,
  inProject,
}: {
  points: MapPoint[];
  focus: string | null;
  inProject: string[] | null;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const active = hover ?? focus;
  const byId = new Map(points.map((p) => [p.id, p]));
  const project = inProject ? new Set(inProject) : null;

  const px = (p: MapPoint) => PAD + p.x * (W - 2 * PAD - LABEL_RIGHT);
  const py = (p: MapPoint) => PAD + p.y * (H - 2 * PAD);

  // Labels, greedily: a label is drawn only where it overlaps no point and no
  // label drawn before. A label starts right of its own point, so its own
  // point's box never stops it.
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = points.map((p) => ({
    x0: px(p) - 5,
    x1: px(p) + 5,
    y0: py(p) - 5,
    y1: py(p) + 5,
  }));
  const labelled = new Set<string>();
  for (const p of [...points].sort((a, b) => a.id.localeCompare(b.id))) {
    const text = `${who(p)}${p.year !== null ? ` ${p.year}` : ''}`;
    const box = { x0: px(p) + 6, x1: px(p) + 6 + text.length * CHAR, y0: py(p) - 7, y1: py(p) + 3 };
    if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
    placed.push(box);
    labelled.add(p.id);
  }

  const activePoint = active ? byId.get(active) : undefined;
  const near = new Set(activePoint?.neighbours.map((n) => n.id) ?? []);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={`Map of ${points.length} works placed by the resemblance of their texts. The same resemblances are listed below the map.`}
      className="max-w-none font-sans"
      onMouseLeave={() => setHover(null)}
    >
      {activePoint
        ? activePoint.neighbours.map((n) => {
            const q = byId.get(n.id);
            if (!q) return null;
            return (
              <line
                key={`line-${n.id}`}
                x1={px(activePoint)}
                y1={py(activePoint)}
                x2={px(q)}
                y2={py(q)}
                stroke="var(--accent)"
                strokeWidth={1}
                opacity={0.3 + 0.7 * Math.max(0, n.similarity)}
              />
            );
          })
        : null}

      {points.map((p) => {
        const isActive = p.id === active;
        const isNear = near.has(p.id);
        const dim = (project && !project.has(p.id)) || (activePoint && !isActive && !isNear);
        const spanish = p.lang === 'spanish';
        const label = `${who(p)}${p.year !== null ? ` ${p.year}` : ''}`;
        return (
          <a
            key={p.id}
            href={`/works/${encodeURIComponent(p.id)}/nearest`}
            onMouseEnter={() => setHover(p.id)}
            onFocus={() => setHover(p.id)}
            onBlur={() => setHover(null)}
          >
            <g opacity={dim ? 0.25 : 1}>
              <title>{`${p.author ?? p.editor ?? ''}${p.author || p.editor ? ', ' : ''}${p.title}${
                p.year !== null ? ` (${p.year})` : ''
              } · ${spanish ? 'Spanish' : 'English'}`}</title>
              <circle cx={px(p)} cy={py(p)} r={10} fill="transparent" />
              <circle
                cx={px(p)}
                cy={py(p)}
                r={isActive ? 6 : 4.5}
                fill={spanish ? (isActive || isNear ? 'var(--accent)' : 'var(--foreground)') : 'var(--background)'}
                stroke={isActive || isNear ? 'var(--accent)' : 'var(--foreground)'}
                strokeWidth={1.25}
              />
              {labelled.has(p.id) || isActive || isNear ? (
                <text
                  x={px(p) + 7}
                  y={py(p) + 3}
                  fontSize={isActive ? 11 : 9}
                  fill={isActive || isNear ? 'var(--foreground)' : 'var(--muted)'}
                >
                  {label}
                </text>
              ) : null}
            </g>
          </a>
        );
      })}
    </svg>
  );
}
