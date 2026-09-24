// lib/matcher.ts against the shared fixtures in tests/matcher/.
//
//     npm run test:matcher        (node --import tsx --test tests/matcher.test.ts)
//
// Run from the repo root. pipeline/test_matcher.py checks pipeline/dossier.py
// against the same files; expected.json and corpus.json are what the Python
// returns, so passing here means returning what the Python returns. The corpus
// test is skipped when tests/matcher/corpus.json is absent (it is gitignored).

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { Book, key, normalize, percent, type Page } from '../lib/matcher';

const DIR = join(process.cwd(), 'tests', 'matcher');

type TextCase = { id: string; why: string; input: string };
type FindCase = {
  id: string;
  why: string;
  book: string;
  quote: string;
  near?: number | null;
  unit?: number[] | null;
};

function read<T>(name: string): T {
  return JSON.parse(readFileSync(join(DIR, name), 'utf8')) as T;
}

// A case: its id, what it is for, how to run it, and the expected value.
type Item = [string, string, () => unknown, unknown];

// Every case is checked and every failure reported, not just the first.
function checkAll(label: string, items: Item[]) {
  const failures: string[] = [];
  for (const [id, why, run, want] of items) {
    let got: unknown;
    try {
      got = run();
      assert.deepStrictEqual(got, want);
    } catch (err) {
      const detail = got === undefined ? String(err) : `got ${JSON.stringify(got)}`;
      failures.push(`${label} ${id} (${why})\n    want ${JSON.stringify(want)}\n    ${detail}`);
    }
  }
  if (failures.length) {
    assert.fail(`${failures.length} of ${items.length} failed:\n` + failures.slice(0, 25).join('\n'));
  }
}

function runFind(books: Map<string, Book>, c: FindCase) {
  return books.get(c.book)!.find(c.quote, c.near ?? null, c.unit ?? []);
}

const cases = read<{
  normalize: TextCase[];
  key: TextCase[];
  books: Record<string, Page[]>;
  find: FindCase[];
}>('cases.json');
const expected = read<{
  normalize: Record<string, string>;
  key: Record<string, string>;
  find: Record<string, unknown>;
  percent: Record<string, string>;
}>('expected.json');

function want(section: Record<string, unknown>, id: string) {
  assert.ok(id in section, `${id} has no expected value: run pipeline/matcher_fixtures.py`);
  return section[id];
}

test('normalize', () => {
  checkAll(
    'normalize',
    cases.normalize.map((c): Item => [c.id, c.why, () => normalize(c.input), want(expected.normalize, c.id)]),
  );
});

test('key', () => {
  checkAll('key', cases.key.map((c): Item => [c.id, c.why, () => key(c.input), want(expected.key, c.id)]));
});

test('find', () => {
  const books = new Map(Object.entries(cases.books).map(([name, pages]): [string, Book] => [name, new Book(pages)]));
  checkAll(
    'find',
    cases.find.map((c): Item => [c.id, c.why, () => runFind(books, c), want(expected.find, c.id)]),
  );
});

test('close-match percentages', () => {
  checkAll(
    'percent',
    Object.entries(expected.percent).map(([ratio, label]): Item => {
      const [matched, length] = ratio.split('/').map(Number);
      return [ratio, 'rounded as Python rounds', () => `close (${percent(matched / length)})`, label];
    }),
  );
});

test('corpus', { skip: !existsSync(join(DIR, 'corpus.json')) && 'tests/matcher/corpus.json is absent' }, () => {
  const corpus = read<{
    books: Record<string, Page[]>;
    find: FindCase[];
    expected: Record<string, unknown>;
  }>('corpus.json');
  const books = new Map(Object.entries(corpus.books).map(([id, pages]): [string, Book] => [id, new Book(pages)]));
  checkAll(
    'corpus',
    corpus.find.map((c): Item => [c.id, c.why, () => runFind(books, c), want(corpus.expected, c.id)]),
  );
});
