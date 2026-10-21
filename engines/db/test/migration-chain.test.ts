/**
 * The drizzle snapshot chain must be a single line that matches the journal.
 *
 * drizzle-kit refuses to `check` or `generate` when two snapshots share an id
 * or point at the same parent ("collision"). That happened once: 0004 was a
 * byte copy of 0003. This guard fails fast in the normal test run instead of
 * waiting for the next person who needs a migration.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const META = resolve(__dirname, '../migrations/meta');
const ROOT_ID = '00000000-0000-0000-0000-000000000000';

interface Snapshot { id: string; prevId: string }
const journal = JSON.parse(readFileSync(resolve(META, '_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string }> };
const snapshots = journal.entries.map((e) => {
  const file = `${String(e.idx).padStart(4, '0')}_snapshot.json`;
  return { file, tag: e.tag, snap: JSON.parse(readFileSync(resolve(META, file), 'utf8')) as Snapshot };
});

describe('migration snapshot chain', () => {
  it('has one snapshot per journal entry, in order', () => {
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i));
  });

  it('every snapshot id is unique', () => {
    const ids = snapshots.map((s) => s.snap.id);
    expect(new Set(ids).size, ids.join(', ')).toBe(ids.length);
  });

  it('each snapshot points at the previous one (no fork, no collision)', () => {
    snapshots.forEach((s, i) => {
      const expected = i === 0 ? ROOT_ID : snapshots[i - 1]!.snap.id;
      expect(s.snap.prevId, `${s.file} (${s.tag})`).toBe(expected);
    });
  });
});
