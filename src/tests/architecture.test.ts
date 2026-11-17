import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve('src');
function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(folder, entry.name);
    return entry.isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}
function moduleRefs(source: string): string[] {
  return Array.from(source.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g), match => match[1]!);
}
function within(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder + sep);
}
function graph(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const specifier of moduleRefs(readFileSync(entry, 'utf8'))) {
    if (specifier.startsWith('.')) graph(resolve(dirname(entry), specifier + (specifier.endsWith('.ts') ? '' : '.ts')), seen);
    else seen.add(specifier);
  }
  return seen;
}

describe('G0-BOUNDARY: pure Core and presentation isolation', () => {
  it('has an actual application and UI boundary to inspect', () => {
    expect(() => readFileSync(resolve(sourceRoot, 'application/ports.ts'))).not.toThrow();
    expect(() => readFileSync(resolve(sourceRoot, 'ui/main.ts'))).not.toThrow();
  });
  it('allows Core only local Core modules and the pure schema validator', () => {
    const core = resolve(sourceRoot, 'core');
    for (const file of sources(core)) {
      const text = readFileSync(file, 'utf8');
      for (const ref of moduleRefs(text)) {
        expect(ref === 'zod' || (ref.startsWith('.') && within(resolve(dirname(file), ref), core)), relative(sourceRoot, file) + ': ' + ref).toBe(true);
      }
      expect(text).not.toMatch(/\b(?:fetch|XMLHttpRequest|window|document|indexedDB|localStorage|process|Date|globalThis)\b|Math\s*(?:\.\s*random|\[)|\b(?:require|eval|import)\s*\(|\bimport\s+\w+\s*=/);
    }
  });
  it('UI and AI cannot transitively reach WorldState, RNG, storage, or platform clients', () => {
    for (const entry of [resolve(sourceRoot, 'ui/main.ts'), resolve(sourceRoot, 'adapters/ai/ports.ts')]) {
      for (const dependency of graph(entry)) {
        expect(within(dependency, resolve(sourceRoot, 'core'))).toBe(false);
        expect(within(dependency, resolve(sourceRoot, 'adapters/storage'))).toBe(false);
        expect(dependency.startsWith(sourceRoot + sep), dependency).toBe(true);
        expect(readFileSync(dependency, 'utf8')).not.toMatch(/\b(?:fetch|XMLHttpRequest|indexedDB|localStorage)\b|\b(?:require|eval|import)\s*\(/);
      }
    }
  });
  it('every UI and AI module retains the same boundary after bootstrap wiring', () => {
    for (const entry of [...sources(resolve(sourceRoot, 'ui')), ...sources(resolve(sourceRoot, 'adapters/ai'))]) {
      for (const dependency of graph(entry)) {
        expect(within(dependency, resolve(sourceRoot, 'core'))).toBe(false);
        expect(within(dependency, resolve(sourceRoot, 'adapters/storage'))).toBe(false);
        expect(dependency.startsWith(sourceRoot + sep), dependency).toBe(true);
        expect(readFileSync(dependency, 'utf8')).not.toMatch(/\b(?:fetch|XMLHttpRequest|indexedDB|localStorage)\b|\b(?:require|eval|import)\s*\(/);
      }
    }
    const entry = readFileSync('index.html', 'utf8');
    expect(entry).toContain('/src/bootstrap.ts');
    const bootstrap = readFileSync(resolve(sourceRoot, 'bootstrap.ts'), 'utf8');
    expect(bootstrap).toContain('mountObservationUI');
    expect(bootstrap).not.toMatch(/(?:window|globalThis)\s*[.[]/);
    for (const file of sources(resolve(sourceRoot, 'ui'))) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    }
  });
});
