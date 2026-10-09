// The way into a project's works cited: one filled button and the style beside
// it, MLA first because her department cites in MLA.
//
// A plain GET form, so it works without client code and the result is a URL
// she can bookmark (/works-cited?project=…&style=…). The style is a native
// select: it opens the system's own menu, which is the one control nobody has
// to learn at two in the morning. Its width is set inline because the global
// select rule in globals.css (width: 100%) sits outside Tailwind's layers and
// so outranks a w-auto class.

const STYLES: { value: string; label: string }[] = [
  { value: 'mla', label: 'MLA 9th' },
  { value: 'chicago', label: 'Chicago 17th' },
  { value: 'chicago18', label: 'Chicago 18th' },
];

export function WorksCitedButton({ projectId, count }: { projectId: number; count: number }) {
  return (
    <form action="/works-cited" method="get" className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="project" value={projectId} />
      <button
        type="submit"
        className="bg-accent px-5 py-2 text-base text-background hover:opacity-90"
      >
        Works cited
      </button>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted">in</span>
        <select name="style" defaultValue="mla" aria-label="Citation style" style={{ width: 'auto' }}>
          {STYLES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </label>
      <span className="text-xs text-muted">
        {count} {count === 1 ? 'entry' : 'entries'}
      </span>
    </form>
  );
}
