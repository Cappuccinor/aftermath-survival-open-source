import { DownloadFailure } from '../../application/save-export';
import type { DownloadPort } from '../../application/save-export';

/** Trusted browser bridge: file contents are opaque Blob bytes, never markup or script. */
export function createBrowserDownload(doc: Document = document, urls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL): DownloadPort {
  let leases = 0;
  return Object.freeze({
    async prepare(file: { readonly filename: string; readonly text: string }, signal: AbortSignal) {
      if (signal.aborted) throw Error('cancelled');
      if (!/^aftermath-manual-[123]-(?:v[12]-r(?:0|[1-9]\d*)|original)\.json$/.test(file.filename) || typeof file.text !== 'string') throw Error('invalid_file');
      if (leases >= 16) throw new DownloadFailure('download_busy');
      const url = urls.createObjectURL(new Blob([file.text], { type: 'application/json;charset=utf-8' }));
      leases++;
      let link: HTMLAnchorElement, released = false, started = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const release = () => {
        if (released) return;
        released = true; leases--; if (timer !== undefined) clearTimeout(timer); signal.removeEventListener('abort', cancelled);
        urls.revokeObjectURL(url);
      };
      const cancelled = () => { if (!started) release(); };
      try {
        link = doc.createElement('a'); link.href = url; link.download = file.filename; link.hidden = true;
        signal.addEventListener('abort', cancelled, { once: true });
        timer = setTimeout(release, 30000);
      } catch (error) { release(); throw error; }
      return Object.freeze({
        start() {
          if (released || started || signal.aborted) throw Error('cancelled_or_already_started');
          try { doc.body.append(link); link.click(); started = true; }
          catch (error) { release(); throw error; }
          finally { link.remove(); }
          signal.removeEventListener('abort', cancelled);
          if (timer !== undefined) clearTimeout(timer);
          timer = setTimeout(release, 30000);
        },
        dispose() { if (!started) release(); },
      });
    },
  });
}
