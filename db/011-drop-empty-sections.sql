-- Scriptorium — migration 011: remove duplicated and dissolved sections
--
-- Run against a database carrying 001–010.
--
-- WHAT WENT WRONG
--
--   Migration 010 inserted 23 sections that already existed under different
--   ids. make_seed.py derived a section id from a title that still carried its
--   letter — "A. Narrative Theory, Poetics, and Psychoanalysis" — giving
--   theory-a-narrative-theory-poetics-and-psychoana. relist.py strips the
--   letter before slugging, giving theory-narrative-theory-poetics-and-psycho.
--
--   Different ids, so the upsert inserted rather than updated, and every
--   section now exists twice: once holding the works, once empty. The bug is in
--   relist.py, which has been changed to keep the letter so a future re-list
--   updates the rows it should.
--
-- WHAT IS REMOVED
--
--   Twenty-two rows in list_sections with no list_items pointing at them,
--   verified empty before writing this. Twenty are the duplicates. Two are
--   sections the department dissolved between the document the catalogue was
--   built from and the final list: Theory F, Ethnography and Ethnic Studies
--   Methods, whose two works moved to Supplementary; and Dissertation I,
--   Textual Interpretation and Narrative Transculturation, which was cut
--   entirely and renumbered J to I.
--
--   make_seed.py deliberately preserves an empty section, on the reasoning
--   that a category the department carved out and left unfilled is itself
--   information. That holds for a section in the CURRENT list. These two are
--   not in the current list at all, and leaving them would put two headings on
--   the Lists page that the department no longer has.
--
-- WHAT IS NOT TOUCHED
--
--   Nothing points at a section except list_items.section_id, and all 22 rows
--   have none. No work, note, anchor, quotation or link is reachable from here.
--   Her writing is in notes, note_works, note_anchors and note_links, and this
--   migration does not read those tables, let alone write them.
--
--   The superseded structure survives in db/seed.sql, in the earlier version of
--   the department's document, and in backups/scriptorium-2026-09-17.sql, which
--   holds all 45 rows.

begin;

-- Guarded: a section that has acquired an item since this was written is left
-- alone rather than dropped. Deleting placement by accident is the one failure
-- here that would be hard to notice.
delete from list_sections s
where not exists (select 1 from list_items li where li.section_id = s.id)
  and s.id in (
    'theory-a-narrative-theory-poetics-and-psychoana',
    'theory-b-haunting-archives-and-embodied-memory',
    'theory-c-coloniality-possession-and-racial-geog',
    'theory-d-chicana-feminisms-indigenous-knowledge',
    'theory-e-indigenous-studies-sovereignty-refusal',
    'theory-f-ethnography-and-ethnic-studies-methods',
    'dissertation-a-colonial-narratives-inquisitorial-arch',
    'dissertation-b-oral-tradition-regional-language-and-f',
    'dissertation-c-witchcraft-healing-and-supernatural-en',
    'dissertation-d-literary-reworkings-and-comparative-in',
    'dissertation-e-hauntology-spectrality-and-historical-',
    'dissertation-f-haunting-as-aesthetic-and-narrative-ex',
    'dissertation-g-chicana-spatial-criticism-borderlands-',
    'dissertation-h-archival-criticism-documents-and-media',
    'dissertation-j-nuevomexicano-cultural-history-and-gen',
    'dissertation-textual-interpretation-and-narrative-tra',
    'teaching-a-nation-race-and-revolution-in-mexican-',
    'teaching-b-mexican-american-print-culture-folklor',
    'teaching-c-chicana-feminisms-embodiment-and-cultu',
    'teaching-d-migration-borders-and-cultural-transla',
    'teaching-e-haunting-death-and-fantastic-narrative',
    'teaching-g-teaching-practice-and-pedagogy'
  );

commit;

-- After running, every section should hold at least one work:
--
--   select s.list_id, s.letter, s.title, count(li.work_id) as items
--   from list_sections s
--   left join list_items li on li.section_id = s.id
--   group by s.id, s.list_id, s.letter, s.title, s.sort
--   order by s.list_id, s.sort;
--
-- Expect 23 rows: Theory A–E plus Supplementary, Dissertation A–I plus
-- Supplementary, Teaching A–F plus Supplementary.
