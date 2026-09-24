// list_gaps: the works on her exam lists that search cannot reach, and why.
//
// This is the Gaps → Files tab as a tool. fileStates() in lib/gaps.ts is the
// rule, used as it is: every examinable work, essays excepted (an essay's
// file is its volume's), in one of five states, and every state but
// searchable is a gap. The reason is the tab's own label, so the model and
// the screen say the same thing. readable is true where pages are loaded,
// so read_pages can still read a work that search does not reach.
//
// pipeline/mcp_server.py carries a copy of the same SQL for the local server;
// lib/gaps.ts is the original.

import { FILE_STATES, fileStates, type FileState } from '@/lib/gaps';

const LABEL = new Map<FileState, string>(FILE_STATES.map((s) => [s.id, s.label]));
const READABLE: FileState[] = ['blocked', 'loaded'];

export async function listGaps() {
  const rows = (await fileStates()).filter((r) => r.state !== 'searchable');
  return {
    count: rows.length,
    works: rows.map((r) => ({
      id: r.id,
      author: r.author,
      title: r.title,
      year: r.year,
      reason: LABEL.get(r.state) ?? r.state,
      readable: READABLE.includes(r.state),
    })),
  };
}

// The count search reports alongside its results.
export async function gapCount(): Promise<number> {
  return (await fileStates()).filter((r) => r.state !== 'searchable').length;
}
