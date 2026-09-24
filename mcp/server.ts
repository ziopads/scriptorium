// The remote MCP server: tool registration, mounted by app/api/mcp/route.ts
// behind OAuth (lib/oauth.ts).
//
// Phased (docs/HANDOFF.md, 23 Sept): find_works, then the read tools (deploy
// 2), search (deploy 3), then the matcher (lib/matcher.ts), find_quotation and
// draft_note (deploy 4, three pushes). Each tool is a port of the same tool in
// pipeline/mcp_server.py, which remains the full set until then.
// Page numbers leave here as they leave the app: page_label with the asterisk,
// page_verified as the notes export writes it (lib/page-verified.ts).

import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

import { draftNote } from '@/mcp/tools/draft-note';
import { findQuotation } from '@/mcp/tools/find-quotation';
import { findWorks } from '@/mcp/tools/find-works';
import { getStudyAid } from '@/mcp/tools/get-study-aid';
import { listClaims } from '@/mcp/tools/list-claims';
import { listNotes } from '@/mcp/tools/list-notes';
import { readPages } from '@/mcp/tools/read-pages';
import { search } from '@/mcp/tools/search';
import { ToolError } from '@/mcp/work';

const INSTRUCTIONS = `Scriptorium holds a doctoral candidate's exam corpus: the books' page text, study aids, and her notes. This connection can read and search, and can propose notes for her review through draft_note; it cannot edit or delete anything.

Name every work by its full id; find_works gives it. Page numbers are printed pages. Every page number comes with page_label, the number as the app shows it, with an asterisk when the number is unverified; quote page_label (pages_label in search and find_quotation results), asterisk included, whenever you cite a page. page_verified is 'yes', 'hand set' (reviewed by a person) or 'no'. page_numbers explains the work's numbering in words. A work whose pages are not citable (never checked, or unsettled and not accepted) can still be read, but its page numbers are not citations.

find_quotation checks a quotation against the page text and returns the book's own words at the match and the page where they were found; quote what it returns, not what you sent.

Anything you write for her goes through draft_note, which verifies every quotation against the page text and stores the book's own words and page; one quotation not found refuses the whole note. Copy quotations exactly from read_pages, search or find_quotation results. For your own analysis, leave attribution out; she decides whose claim it is. Use 'author' only when the note reports the anchored work's own position, and 'other' with attributed_to for a third party's. The note waits in her proposals queue until she accepts or rejects it.

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
      'search',
      {
        title: 'Search',
        description:
          'Semantic search over the corpus, in English or Spanish; a query in one language finds text in the ' +
          "other. Optionally limited to works (full ids) or to one language ('english' or 'spanish'). Front " +
          'matter is excluded unless asked for. Each result gives the work, printed pages (pages_label is the ' +
          "form to cite), similarity (1 is identical) and the chunk's text.",
        inputSchema: z.object({
          query: z.string(),
          work_ids: z.array(z.string()).optional().describe('full work ids'),
          lang: z.enum(['english', 'spanish']).optional(),
          k: z.number().int().optional().describe('results to return, default 8, at most 30'),
          include_front_matter: z.boolean().optional(),
        }),
      },
      async (args) => run(() => search(args)),
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
      'find_quotation',
      {
        title: 'Find quotation',
        description:
          "Look a passage up in a work's page text with the matcher that verifies every stored quotation. " +
          'Exact on the named page and its neighbours, then the whole book; a close match (92 per cent of the ' +
          'characters) on the named page and its neighbours only. Returns the book\'s own text at the match, ' +
          'the printed page (page_label and pages_label are the forms to cite), whether the match was exact or ' +
          'close, whether the page is front matter, and whether the work is citable. Use it to check a quotation ' +
          'before quoting it.',
        inputSchema: z.object({
          work_id: z.string().describe('full work id'),
          text: z.string().describe('the passage, copied exactly; at least 25 characters'),
          near_page: z.number().int().optional().describe('printed page where it appears, if known'),
        }),
      },
      async ({ work_id, text, near_page }) => run(() => findQuotation(work_id, text, near_page)),
    );

    server.registerTool(
      'draft_note',
      {
        title: 'Draft note',
        description:
          'Propose a note for her review, anchored to one or more verified quotations. Every quotation is ' +
          'looked up in its book; if any is not found, is on front matter, or comes from a work whose page ' +
          'numbering is not settled, nothing is written. What is stored is the book\'s own text and the page ' +
          "where it was found. attribution: 'author' when the note reports the anchored work's own position, " +
          "'other' with attributed_to for a third party, omitted for your own analysis ('own' is hers to assign). " +
          "The 'dossier' tag is reserved. The note waits in her proposals queue until she accepts or rejects it.",
        inputSchema: z.object({
          body: z.string().describe("the note's text"),
          quotations: z
            .array(
              z.object({
                work_id: z.string().describe('full id of the work quoted'),
                text: z.string().describe('copied exactly from the page, at least 25 characters'),
                near_page: z.number().int().optional().describe('printed page where it appears, if known'),
              }),
            )
            .describe('at least one'),
          attribution: z.string().optional().describe("'author' or 'other'; omit for your own analysis"),
          attributed_to: z.string().optional().describe("whose claim, with attribution 'other'"),
          title: z.string().optional(),
          tags: z.array(z.string()).optional(),
        }),
      },
      async (args) => run(() => draftNote(args)),
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
    serverInfo: { name: 'scriptorium', version: '0.5.1' },
  },
);
