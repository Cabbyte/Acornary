import { it, expect } from 'vitest';
import { terminalLabelTimes, type LabelHistoryEvent } from '../apps/server/src/terminal-label-history.js';
import type { InventoryData } from '../packages/contracts/src/web.js';
const created = '2026-10-01T00:00:00.000Z', modified = '2026-10-31T01:00:00.000Z';
const data = (): InventoryData => ({ household:{id:'h',name:'家'},container_catalog_id:'container',cached_at:modified,notes:[],
 catalog:[{id:'sku',parent_id:null,kind:'SKU',name:'牛奶',revision:2,attributes:[{template_id:'product',template_version:1,values:{specification:'500 mL'}}]}],
 items:[{id:'item1',parent_id:null,catalog_node_id:'sku',display_name:null,revision:2,attributes:[],created_at:created},
 {id:'custom',parent_id:null,catalog_node_id:'sku',display_name:'自己的名称',revision:1,attributes:[],created_at:created}] });
const event = (target_kind:string,target_id:string,path:string,before:unknown,after:unknown,time=modified): LabelHistoryEvent =>
 ({id:'event1',target_kind,target_id,before_revision:1,recorded_at:time,changes:[{path,before,after}]});
it('uses recorded label changes; hidden SKU names do not affect custom titles',()=>{
 const result=terminalLabelTimes(data(),[event('CATALOG_NODE','sku','name','鲜奶','牛奶')]);
 expect(result.get('item1')).toBe(modified);expect(result.get('custom')).toBe(created);
});
it('fans out specification edits, including custom-named items',()=>{
 const result=terminalLabelTimes(data(),[event('CATALOG_NODE','sku','attributes.product.specification','250 mL','500 mL')]);
 expect([...result.values()]).toEqual([modified,modified]);
});
it('ignores notes, movement, quantity and opening, and never uses sync time',()=>{
 const events=['parent_id','notes.n.body','attributes.contents.remaining','attributes.lifecycle.opening.opened_at'].map(path=>event('ITEM','item1',path,'old','new'));
 expect(terminalLabelTimes(data(),events).get('item1')).toBe(created);
});
it('date removal counts, but changing an invisible date kind does not',()=>{
 expect(terminalLabelTimes(data(),[event('ITEM','item1','attributes.lifecycle.expiry.date','2026-12-01',undefined)]).get('item1')).toBe(modified);
 expect(terminalLabelTimes(data(),[event('ITEM','item1','attributes.lifecycle.expiry.date_kind','USE_BY','ESTIMATED')]).get('item1')).toBe(created);
});
it('reconstructs SKU reassignment rather than counting edits before or after ownership',()=>{
 const d=data();d.catalog.push({...d.catalog[0],id:'old',name:'牛奶'});
 const result=terminalLabelTimes(d,[event('ITEM','item1','catalog_node_id','old','sku',modified),
  {...event('CATALOG_NODE','sku','attributes.product.specification','250 mL','500 mL','2026-10-10T00:00:00Z'),id:'event0'}]);
 // Catalog reassignment to identical visible content is not a label edit; the older SKU update happened before assignment.
 expect(result.get('item1')).toBe(created);
 expect(result.get('custom')).toBe('2026-10-10T00:00:00.000Z');
});
it('no-op same visible title changes do not create a recent candidate',()=>{
 expect(terminalLabelTimes(data(),[event('ITEM','item1','display_name','牛奶',null)]).get('item1')).toBe(created);
});
