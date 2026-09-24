'use client';

import { useState } from 'react';

import type { AxisMapLayout } from '@/lib/axis-map';

// Draws the layout computed in lib/axis-map.ts. Client code only for hover:
// pointing at an axis or a work lights its lines and dims the rest. Every
// axis opens its page; every work opens in the workbench.
//
// Ink only, in the application's own colours: lines in muted ink, bridges and
// anything lit in the accent. Solid for a ficha, dashed for a work named only
// in the synthesis. Text stays in text colour.

type Focus = { kind: 'axis'; id: number } | { kind: 'work'; id: string } | null;

const TEXT_W = 6.2; // rough width of one character at 11px, for label backgrounds

export function AxisMap({ layout }: { layout: AxisMapLayout }) {
  const [focus, setFocus] = useState<Focus>(null);
  const axisById = new Map(layout.axes.map((a) => [a.id, a]));
  const workById = new Map(layout.works.map((w) => [w.id, w]));

  const lit = (axis: number, work: string) =>
    focus === null ||
    (focus.kind === 'axis' && focus.id === axis) ||
    (focus.kind === 'work' && focus.id === work);
  const axisLit = (id: number) =>
    focus === null ||
    (focus.kind === 'axis' && focus.id === id) ||
    (focus.kind === 'work' && (workById.get(focus.id)?.axes.includes(id) ?? false));
  const workLit = (id: string) =>
    focus === null ||
    (focus.kind === 'work' && focus.id === id) ||
    (focus.kind === 'axis' && (workById.get(id)?.axes.includes(focus.id) ?? false));

  const bridges = layout.works.filter((w) => w.shared).length;

  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width={layout.width}
      height={layout.height}
      role="img"
      aria-label={`Map of ${layout.axes.length} axes and the ${layout.works.length} works they bind; ${bridges} ${
        bridges === 1 ? 'work is' : 'works are'
      } shared between axes. The same content is listed below the map.`}
      className="max-w-none font-sans"
      onMouseLeave={() => setFocus(null)}
    >
      {/* Spines and ticks: the works of one axis. */}
      {layout.spines.map((s) => (
        <line
          key={`spine-${s.axis}`}
          x1={s.x}
          y1={s.y1}
          x2={s.x}
          y2={s.y2}
          stroke="var(--muted)"
          strokeWidth={1}
          opacity={axisLit(s.axis) ? 0.7 : 0.15}
        />
      ))}
      {layout.edges
        .filter((e) => !workById.get(e.work)?.shared)
        .map((e) => {
          const w = workById.get(e.work);
          const a = axisById.get(e.axis);
          if (!w || !a) return null;
          return (
            <line
              key={`tick-${e.axis}-${e.work}`}
              x1={a.x + 12}
              y1={w.y - 4}
              x2={w.x - 4}
              y2={w.y - 4}
              stroke={focus && lit(e.axis, e.work) ? 'var(--accent)' : 'var(--muted)'}
              strokeWidth={1}
              strokeDasharray={e.ficha ? undefined : '3 3'}
              opacity={lit(e.axis, e.work) ? 0.8 : 0.15}
            />
          );
        })}

      {/* Bridges: curves from each axis to a shared work. */}
      {layout.edges
        .filter((e) => workById.get(e.work)?.shared)
        .map((e) => {
          const w = workById.get(e.work)!;
          const a = axisById.get(e.axis);
          if (!a) return null;
          const y0 = layout.boxBottom;
          const y1 = w.y - 14;
          const mid = (y0 + y1) / 2;
          return (
            <path
              key={`bridge-${e.axis}-${e.work}`}
              d={`M ${a.cx} ${y0} C ${a.cx} ${mid}, ${w.x} ${mid}, ${w.x} ${y1}`}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.5}
              strokeDasharray={e.ficha ? undefined : '4 3'}
              opacity={lit(e.axis, e.work) ? 0.9 : 0.15}
            />
          );
        })}

      {/* Axes. */}
      {layout.axes.map((a) => (
        <a
          key={`axis-${a.id}`}
          href={`/axes/${a.id}`}
          onMouseEnter={() => setFocus({ kind: 'axis', id: a.id })}
          onFocus={() => setFocus({ kind: 'axis', id: a.id })}
          onBlur={() => setFocus(null)}
        >
          <g opacity={axisLit(a.id) ? 1 : 0.35}>
            <title>{a.title}</title>
            <rect
              x={a.x + 4}
              y={8}
              width={152}
              height={layout.boxBottom - 8}
              fill="#fff"
              stroke={focus?.kind === 'axis' && focus.id === a.id ? 'var(--accent)' : 'var(--rule)'}
            />
            <text x={a.x + 10} y={8 + 17} fontSize={11.5} fill="var(--foreground)">
              {a.lines.map((line, i) => (
                <tspan key={i} x={a.x + 10} dy={i === 0 ? 0 : 15}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        </a>
      ))}

      {/* Works. */}
      {layout.works.map((w) => {
        const width = w.label.length * TEXT_W + 8;
        return (
          <a
            key={`work-${w.id}`}
            href={`/?w=${encodeURIComponent(w.id)}`}
            onMouseEnter={() => setFocus({ kind: 'work', id: w.id })}
            onFocus={() => setFocus({ kind: 'work', id: w.id })}
            onBlur={() => setFocus(null)}
          >
            <g opacity={workLit(w.id) ? 1 : 0.3}>
              <title>{`${w.full}${w.shared ? ` · in ${w.axes.length} axes` : ''}`}</title>
              {w.shared ? (
                <rect
                  x={w.x - width / 2}
                  y={w.y - 13}
                  width={width}
                  height={17}
                  fill="var(--background)"
                  stroke="var(--accent)"
                  strokeWidth={1}
                />
              ) : (
                <rect x={w.x - 2} y={w.y - 12} width={width} height={16} fill="transparent" />
              )}
              <text
                x={w.x}
                y={w.y}
                fontSize={11}
                textAnchor={w.shared ? 'middle' : 'start'}
                fill={w.shared ? 'var(--accent)' : 'var(--foreground)'}
              >
                {w.label}
              </text>
            </g>
          </a>
        );
      })}
    </svg>
  );
}
