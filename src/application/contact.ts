import type {WorldState} from '../core/world';
import {projectLocation} from '../core/movement';
/** Advertises an action at the known current place, never a hidden NPC presence. */
export function projectContactTarget(world:WorldState){
 const location=projectLocation(world);
 return world.stateSchema==='g2-world-v2'&&location?Object.freeze({targetId:location.targetId,label:'近处'}):null;
}
