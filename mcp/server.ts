// The remote MCP server: tool registration, mounted by app/api/mcp/[key]/route.ts.
//
// Phased (docs/HANDOFF.md, 23 Sept): deploy 1 is find_works alone, catalogue
// data only, behind an unguessable path and Anthropic's address range. No book
// text is served until the server sits behind OAuth tied to her login. The
// local Python server (pipeline/mcp_server.py) remains the full set of tools.

import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { findWorks } from '@/mcp/tools/find-works';

const INSTRUCTIONS = `Scriptorium holds a doctoral candidate's exam corpus and her notes. This connection offers catalogue lookup only, for now.

Name every work by its full id; find_works gives it. Each work reports numbering (whether its page numbers were checked) and page_numbers: 'verified'; 'hand set' (reviewed by a person); 'unverified', either 'the file's own page, not the edition's' or 'numbering unsettled'; or 'unchecked'. has_pages and searchable say whether the book's text is loaded and embedded.`;

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'find_works',
      {
        title: 'Find works',
        description:
          'Works whose id, author or title contains the query, accents and case ignored. ' +
          'Returns full ids, whether pages and search chunks are loaded, and the state ' +
          'of the page numbering.',
        inputSchema: z.object({
          query: z.string().describe('part of an author, title or id'),
        }),
      },
      async ({ query }) => {
        try {
          return json(await findWorks(query));
        } catch (err) {
          return { ...json({ error: (err as Error).message }), isError: true };
        }
      },
    );
  },
  {
    instructions: INSTRUCTIONS,
    serverInfo: { name: 'scriptorium', version: '0.1.0' },
  },
);
