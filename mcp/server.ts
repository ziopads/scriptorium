// The remote MCP server: tool registration, mounted by app/api/mcp/route.ts
// behind OAuth (lib/oauth.ts).
//
// Phased (docs/HANDOFF.md, 23 Sept): find_works, then the read tools (deploy
// 2), then search, then the matcher and draft_note. Each tool is a port of the
// same tool in pipeline/mcp_server.py, which remains the full set until then.
// Page numbers leave here as they leave the app: page_label with the asterisk,
// page_verified as the notes export writes it (lib/page-verified.ts).

import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

import { findWorks } from '@/mcp/tools/find-works';
import { getStudyAid } from '@/mcp/tools/get-study-aid';
import { listClaims } from '@/mcp/tools/list-claims';
import { listNotes } from '@/mcp/tools/list-notes';
import { readPages } from '@/mcp/tools/read-pages';
import { ToolError } from '@/mcp/work';

const INSTRUCTIONS = `Scriptorium holds a doctoral candidate's exam corpus: the books' page text, study aids, and her notes. This connection can read; it cannot yet search semantically or write notes.

Name every work by its full id; find_works gives it. Page numbers are printed pages. Every page number comes with page_label, the number as the app shows it, with an asterisk when the number is unverified; quote page_label, asterisk included, whenever you cite a page. page_verified is 'yes', 'hand set' (reviewed by a person) or 'no'. page_numbers explains the work's numbering in words. A work whose pages are not citable (never checked, or unsettled and not accepted) can still be read, but its page numbers are not citations.

Study-aid sections and notes say whether she has reviewed them. An unreviewed section, or a note with origin 'assistant' and reviewed false, is a draft or a pending proposal, not her view; say so when you use it. Notes carry an attribution (author, own, other) saying whose claim they state.`;

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

// A ToolError is for the model to read and act on; anything else is a bug,
// logged here and reported without detail.
async function run(fn: () => Promise<unknown>) {
  try {
    return json(await fn());
  } catch (err) {
    if (err instanceof ToolError) return { ...json({ error: err.message }), isError: true };
    console.error('mcp tool', err);
    return { ...json({ error: 'internal error' }), isError: true };
  }
}

export const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'find_works',
      {
        title: 'Find works',
        description:
          'Works whose id, author or title contains the query, accents and case ignored. Returns full ids, ' +
          'whether pages and search chunks are loaded, the state of the page numbering, and the internal ' +
          'note, which records known problems with the file (a partial copy, ebook pagination).',
        inputSchema: z.object({ query: z.string().describe('part of an author, title or id') }),
      },
      async ({ query }) => run(() => findWorks(query)),
    );

    server.registerTool(
      'read_pages',
      {
        title: 'Read pages',
        description:
          "Page text by printed page number, at most ten pages per call. Each page says how sure its number is: " +
          "'printed' where the number read off the page agrees, 'computed' where the page carries no readable " +
          "number and it comes from the book's offset alone, 'front matter' below page 1, and a warning where " +
          'the number read off the page disagrees. page_label is the number to cite.',
        inputSchema: z.object({
          work_id: z.string().describe('full work id'),
          first_page: z.number().int(),
          last_page: z.number().int().optional(),
        }),
      },
      async ({ work_id, first_page, last_page }) => run(() => readPages(work_id, first_page, last_page)),
    );

    server.registerTool(
      'get_study_aid',
      {
        title: 'Get study aid',
        description:
          "A work's dossier: summary, key arguments, key terms and theme bridges. Each section says whether " +
          "she has reviewed it. Unreviewed sections are the assistant's drafts and are not her views.",
        inputSchema: z.object({ work_id: z.string().describe('full work id') }),
      },
      async ({ work_id }) => run(() => getStudyAid(work_id)),
    );

    server.registerTool(
      'list_claims',
      {
        title: 'List claims',
        description:
          'The dossier claims about a work that she has accepted, each with its verified quotations and printed ' +
          'pages. Claims still awaiting her review, and those she rejected, are left out.',
        inputSchema: z.object({ work_id: z.string().describe('full work id') }),
      },
      async ({ work_id }) => run(() => listClaims(work_id)),
    );

    server.registerTool(
      'list_notes',
      {
        title: 'List notes',
        description:
          'Her notes, filtered by a work (full id), a tag, or text in the title or body; at least one filter. ' +
          'Rejected proposals and unreviewed dossier claims are left out, as in the app. Each note says who ' +
          'wrote it (origin) and whether she has reviewed it; an unreviewed assistant note is a pending ' +
          'proposal, not her writing.',
        inputSchema: z.object({
          work_id: z.string().optional().describe('full work id'),
          tag: z.string().optional(),
          contains: z.string().optional().describe('text in the title or body'),
        }),
      },
      async (args) => run(() => listNotes(args)),
    );
  },
  {
    instructions: INSTRUCTIONS,
    serverInfo: { name: 'scriptorium', version: '0.2.0' },
  },
);
