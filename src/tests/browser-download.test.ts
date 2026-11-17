import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserDownload } from '../adapters/storage/browser-download';
function environment() {
  const links: { href: string; download: string; hidden: boolean; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }[] = [];
  const blobs: Blob[] = [];
  const doc = { createElement: vi.fn(() => { const link = { href: '', download: '', hidden: false, click: vi.fn(), remove: vi.fn() }; links.push(link); return link; }), body: { append: vi.fn() } };
  const urls = { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:local-' + blobs.length; }), revokeObjectURL: vi.fn() };
  const port = createBrowserDownload(doc as unknown as Document, urls);
  return { port, links, blobs, doc, urls };
}
const file = { filename: 'aftermath-manual-1-original.json', text: '\uFEFF中文😀 <script>never execute</script>' };
beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
describe('bounded browser download resource leases', () => {
  it('prepares opaque UTF8 Blob and safe filename without a click; start triggers one download', async () => {
    const e = environment(), lease = await e.port.prepare(file, new AbortController().signal);
    expect(new Uint8Array(await e.blobs[0]!.arrayBuffer())).toEqual(new TextEncoder().encode(file.text)); expect(e.links[0]!.click).not.toHaveBeenCalled();
    lease.start(); expect(e.links[0]!.click).toHaveBeenCalledTimes(1); expect(e.links[0]!.download).toBe(file.filename);
    expect(e.links[0]!.href).toBe('blob:local-1'); expect(e.links[0]!.hidden).toBe(true); expect(e.links[0]!.remove).toHaveBeenCalled();
    expect(() => lease.start()).toThrow(); expect(e.links[0]!.click).toHaveBeenCalledTimes(1);
  });
  it('does not immediately revoke a started download and releases it after 30 seconds exactly once', async () => {
    const e = environment(), lease = await e.port.prepare(file, new AbortController().signal); lease.start(); lease.dispose(); lease.dispose();
    expect(e.urls.revokeObjectURL).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(29999); expect(e.urls.revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(e.urls.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:local-1');
  });
  it('cancels a prepared download and removes URL; subsequent start cannot click', async () => {
    const e = environment(), controller = new AbortController(), lease = await e.port.prepare(file, controller.signal); controller.abort();
    expect(() => lease.start()).toThrow(); expect(e.links[0]!.click).not.toHaveBeenCalled(); expect(e.urls.revokeObjectURL).toHaveBeenCalledTimes(1);
    lease.dispose(); await vi.advanceTimersByTimeAsync(30000); expect(e.urls.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
  it('dispose before start and an abandoned preparation both release without downloading', async () => {
    const e = environment(), first = await e.port.prepare(file, new AbortController().signal); first.dispose(); expect(() => first.start()).toThrow();
    const second = await e.port.prepare(file, new AbortController().signal); await vi.advanceTimersByTimeAsync(30000); expect(() => second.start()).toThrow();
    expect(e.urls.revokeObjectURL).toHaveBeenCalledTimes(2); expect(e.links.every(x => x.click.mock.calls.length === 0)).toBe(true);
  });
  it('caps outstanding resources at 16, releases after expiry and allows explicit retry', async () => {
    const e = environment(); for (let i = 0; i < 16; i++) (await e.port.prepare(file, new AbortController().signal)).start();
    await expect(e.port.prepare(file, new AbortController().signal)).rejects.toThrow('download_busy'); expect(e.blobs).toHaveLength(16);
    await vi.advanceTimersByTimeAsync(30000); expect(e.urls.revokeObjectURL).toHaveBeenCalledTimes(16);
    (await e.port.prepare(file, new AbortController().signal)).start(); expect(e.blobs).toHaveLength(17);
  });
  it('rejects already aborted requests and unsafe filenames before allocating resources', async () => {
    const e = environment(), c = new AbortController(); c.abort(); await expect(e.port.prepare(file, c.signal)).rejects.toThrow();
    for (const filename of ['../save.json', 'name.html', 'aftermath-manual-4-original.json', 'aftermath-manual-1-v1-rNaN.json']) await expect(e.port.prepare({ ...file, filename }, new AbortController().signal)).rejects.toThrow();
    expect(e.blobs).toHaveLength(0);
  });
  it('a bridge click failure removes the anchor and promptly releases the URL', async () => {
    const e = environment(), lease = await e.port.prepare(file, new AbortController().signal); e.links[0]!.click.mockImplementation(() => { throw Error('blocked'); });
    expect(() => lease.start()).toThrow('blocked'); lease.dispose(); expect(e.links[0]!.remove).toHaveBeenCalled(); expect(e.urls.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
  it('aborting after browser handoff does not pretend to cancel or revoke the in-flight file', async () => {
    const e = environment(), c = new AbortController(), lease = await e.port.prepare(file, c.signal); lease.start(); c.abort(); lease.dispose();
    expect(e.urls.revokeObjectURL).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(30000); expect(e.urls.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
