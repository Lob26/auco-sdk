import { readdirSync, readFileSync } from 'node:fs';

/** One file of `fixtures/`, as recorded from 1.0.9. */
export interface Fixture {
  readonly file: string;
  readonly id: string;
  readonly variant: string | null;
  readonly products: readonly string[];
  readonly data: Record<string, unknown>;
}

const dir = new URL('../fixtures/', import.meta.url);

export const fixtures: readonly Fixture[] = readdirSync(dir)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => ({
    file,
    ...(JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as Omit<
      Fixture,
      'file'
    >),
  }));

/** The single fixture with this id and variant, or a loud failure. */
export const fixture = (id: string, variant: string | null = null): Fixture => {
  const found = fixtures.find((f) => f.id === id && f.variant === variant);
  if (!found) throw new Error(`No fixture ${id} with variant ${variant}`);
  return found;
};
