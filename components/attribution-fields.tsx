import type { Attribution } from '@/lib/types';
import { ATTRIBUTION_LABEL } from '@/lib/types';

// The one question the interface asks that she would not ask herself: whose
// claim is this? Three radios and no default. An unanswered form stores null,
// which the notes page surfaces as "unclassified" rather than guessing.
//
// The attributed_to field is always rendered; the action ignores it unless
// 'other' is chosen, so nothing depends on client JavaScript.

const ORDER: Attribution[] = ['author', 'own', 'other'];

export function AttributionFields({
  current,
  attributedTo,
  name = 'attribution',
}: {
  current?: Attribution | null;
  attributedTo?: string | null;
  name?: string;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm">Whose claim is this?</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {ORDER.map((value) => (
          <label key={value} className="flex items-center gap-1.5">
            <input
              type="radio"
              name={name}
              value={value}
              defaultChecked={current === value}
            />
            {ATTRIBUTION_LABEL[value]}
          </label>
        ))}
      </div>
      <label className="block space-y-1 pt-1">
        <span className="text-xs text-muted">If someone else: who?</span>
        <input
          type="text"
          name="attributed_to"
          defaultValue={attributedTo ?? ''}
          placeholder="Álvaro F. Bolaños"
          className="max-w-xs"
        />
      </label>
    </fieldset>
  );
}

// The badge that renders the answer, wherever a note appears.
export function AttributionBadge({
  attribution,
  attributedTo,
  unsupported,
}: {
  attribution: Attribution | null;
  attributedTo: string | null;
  unsupported: boolean;
}) {
  if (attribution === null) {
    return <span className="italic text-accent">whose claim? unclassified</span>;
  }
  if (attribution === 'author') {
    return unsupported ? (
      <span className="text-accent">author’s claim, no passage behind it</span>
    ) : (
      <span>author’s claim</span>
    );
  }
  if (attribution === 'own') return <span>her own claim</span>;
  return <span>{attributedTo ? `${attributedTo}’s claim` : 'someone else’s claim'}</span>;
}
