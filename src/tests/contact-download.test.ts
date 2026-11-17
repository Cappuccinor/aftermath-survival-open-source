import {afterEach,expect,it,vi} from 'vitest';
import {createBrowserDownload} from '../adapters/storage/browser-download';
afterEach(()=>vi.useRealTimers());
it('real browser bridge accepts only both implemented save versions and releases the opaque blob',async()=>{
 vi.useFakeTimers();const click=vi.fn(),remove=vi.fn(),append=vi.fn(),urls={createObjectURL:vi.fn(()=> 'blob:test'),revokeObjectURL:vi.fn()},doc={createElement:()=>({click,remove}),body:{append}} as unknown as Document;
 const bridge=createBrowserDownload(doc,urls),signal=new AbortController().signal;
 for(const version of [1,2]){const prepared=await bridge.prepare({filename:`aftermath-manual-1-v${version}-r42.json`,text:'exact原文'},signal);prepared.start();prepared.dispose();}
 expect(click).toHaveBeenCalledTimes(2);expect(urls.createObjectURL).toHaveBeenCalledTimes(2);
 for(const filename of ['aftermath-manual-1-v3-r42.json','../bad.json','aftermath-manual-4-v2-r42.json'])await expect(bridge.prepare({filename,text:'x'},signal)).rejects.toThrow('invalid_file');
 await vi.advanceTimersByTimeAsync(30000);expect(urls.revokeObjectURL).toHaveBeenCalledTimes(2);
});
