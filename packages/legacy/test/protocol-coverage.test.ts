import { describe, expect, it } from 'vitest';
import { loadFixtures, readProtocol, SDK_TYPES } from './support';

// PROTOCOL.md and fixtures/ are one contract: a message documented without a
// fixture, or a fixture whose message is not documented, is drift. The check
// runs per variant: every file a section's "Fixtures" row links exists, and
// every fixture file is linked from the row of its own id.
const protocol = readProtocol();
const headingIds = [...protocol.matchAll(/^### `([^`]+)`\s*$/gm)].map(
  (match) => match[1] ?? ''
);
const fixtures = loadFixtures();
const fixtureIds = new Set(fixtures.map((f) => f.id));
const fixtureFiles = fixtures.map((f) => f.file);

/** Each message section: from its `### `<id>`` heading to the next heading. */
const sections = protocol.split(/^(?=#{1,3} )/m).flatMap((body) => {
  const id = /^### `([^`]+)`\s*$/m.exec(body)?.[1];
  return id ? [{ id, body }] : [];
});

const linkedFixtures = sections.map(({ id, body }) => {
  const rows = body.match(/^\| Fixtures \|.*$/gm) ?? [];
  const links = [
    ...(rows[0] ?? '').matchAll(/\[`([^`]+)`\]\(\.\/fixtures\/([^)]+)\)/g),
  ].map((link) => ({ text: link[1] ?? '', file: link[2] ?? '' }));
  // `**`<variant>`**` paragraphs document a payload variant in prose.
  const proseVariants = [...body.matchAll(/^\*\*`([a-z0-9-]+)`\*\*/gm)].map(
    (match) => match[1] ?? ''
  );
  return { id, rows: rows.length, links, proseVariants };
});

describe('PROTOCOL.md ⇄ fixtures', () => {
  it('documents messages under unique `### `<id>`` headings', () => {
    expect(headingIds.length).toBeGreaterThan(0);
    expect(new Set(headingIds).size).toBe(headingIds.length);
    expect(sections.map((s) => s.id)).toEqual(headingIds);
  });

  it.each(headingIds)('heading %s has at least one fixture', (id) => {
    expect(fixtureIds).toContain(id);
  });

  it.each([...fixtureIds])('fixture id %s has a heading', (id) => {
    expect(headingIds).toContain(id);
  });
});

describe.each(linkedFixtures)('section $id: Fixtures row', (section) => {
  it('has exactly one Fixtures row linking at least one file', () => {
    expect(section.rows).toBe(1);
    expect(section.links.length).toBeGreaterThan(0);
  });

  it('links each file under its own name, once', () => {
    for (const link of section.links) expect(link.text).toBe(link.file);
    const files = section.links.map((l) => l.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it('links only existing fixtures of this id', () => {
    for (const { file } of section.links) {
      expect(fixtureFiles).toContain(file);
      expect(fixtures.find((f) => f.file === file)?.id).toBe(section.id);
    }
  });

  it('links every fixture of this id', () => {
    const own = fixtures.filter((f) => f.id === section.id).map((f) => f.file);
    expect(section.links.map((l) => l.file).sort()).toEqual(own.sort());
  });

  it('links a fixture for every variant documented in prose', () => {
    for (const variant of section.proseVariants) {
      expect(section.links.map((l) => l.file)).toContain(
        `${section.id}.${variant}.json`
      );
    }
  });
});

describe.each(fixtures)('fixture $file', (f) => {
  it('is named <id>.json or <id>.<variant>.json, matching its variant', () => {
    expect(f.file).toBe(
      f.variant === null ? `${f.id}.json` : `${f.id}.${f.variant}.json`
    );
  });

  it('declares the direction its id prefix implies', () => {
    const expected = f.id.startsWith('frame.')
      ? 'frame-to-host'
      : f.id.startsWith('host.')
        ? 'host-to-frame'
        : `unknown prefix in ${f.id}`;
    expect(f.direction).toBe(expected);
  });

  it('cites a source line in the 1.0.9 code', () => {
    expect(f.source).toMatch(/^src\/(index|types)\.ts#L\d+(-L\d+)?$/);
  });

  it('carries a confidence label', () => {
    expect(['code', 'docs', 'inferred']).toContain(f.confidence);
  });

  it('carries a non-empty data object', () => {
    expect(f.data).toBeTypeOf('object');
    expect(f.data).not.toBeNull();
    expect(Array.isArray(f.data)).toBe(false);
    expect(Object.keys(f.data).length).toBeGreaterThan(0);
  });

  it('lists only known sdkTypes as products', () => {
    expect(f.products.length).toBeGreaterThan(0);
    for (const product of f.products) {
      expect(SDK_TYPES).toContain(product);
    }
  });
});
