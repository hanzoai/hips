// The status vocabulary, read from the one file that holds it.
//
// Five page components used to carry their own map of status to badge colour,
// and lib/source.ts declared a seventh spelling as a TypeScript union. All six
// listed `Last Call`, `Withdrawn` and `Stagnant` -- words no proposal has ever
// carried -- and none of them listed the word 52 proposals DID carry, so every
// one of those rendered with the fallback grey badge and counted toward none of
// the three stat tiles on the home page.
//
// ../vocabulary.json is the corpus's own machine copy; scripts/lint-hips.py and
// scripts/index.py read the same file. Adding a status is one edit, there.

import vocabulary from '../../vocabulary.json';

// A tone, not a colour: the vocabulary says what a status MEANS, and this is the
// only place that decides what that looks like.
const TONE: Record<string, string> = {
  amber: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  green: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  blue: 'bg-sky-500/10 text-sky-500 border-sky-500/20',
};

const NEUTRAL = 'bg-muted text-muted-foreground border-border';

type Entry = { means: string; tone: string };
const STATUS = vocabulary.status as Record<string, Entry>;

/** Every status a proposal may carry, in lifecycle order. */
export const STATUSES = Object.keys(STATUS);

/** Tailwind classes for a status badge. Unknown or absent renders neutral. */
export function statusClass(status?: string | null): string {
  const entry = status ? STATUS[status] : undefined;
  return entry ? TONE[entry.tone] ?? NEUTRAL : NEUTRAL;
}

/** What the status means, for a tooltip or a legend. */
export function statusMeans(status?: string | null): string {
  return (status && STATUS[status]?.means) || '';
}
