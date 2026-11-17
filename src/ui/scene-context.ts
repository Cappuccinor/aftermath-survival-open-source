import type { VisibleSceneContext } from '../application/ports';

/** Only controlled public facts reach these templates; no world access or action dispatch. */
export function describeSceneContext(context: VisibleSceneContext): string {
  const place = context.locationRole === 'room'
    ? '你在一栋废弃居民楼的房间里，房门通向已知的相邻走廊。'
    : '你在废弃居民楼的走廊里，沿已知路线可以返回刚才的房间。';
  return place + (context.light === 'clear' ? '光线足够，周围的明暗清晰可辨。' : '光线不足，周围细节难以辨清。');
}
export function createSceneContextPanel(doc: Document) {
  const element = doc.createElement('section'); element.id = 'scene-context'; element.setAttribute('aria-labelledby', 'scene-title');
  const title = doc.createElement('h2'); title.id = 'scene-title';
  const description = doc.createElement('p'); description.id = 'scene-description'; description.className = 'narrative';
  element.append(title, description);
  return { element, render(context: VisibleSceneContext | null) {
    element.hidden = context === null;
    title.textContent = context ? `废弃居民楼 · ${context.locationRole === 'room' ? '房间' : '走廊'}` : '';
    description.textContent = context ? describeSceneContext(context) : '';
  } };
}
