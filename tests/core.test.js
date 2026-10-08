import{test}from'node:test';import assert from'node:assert/strict';import{safeUrl,duplicateIds,filterTools}from'../extension/core.js';
test('重复清理保留固定与活动标签，不合并不同查询参数',()=>{assert.deepEqual(duplicateIds([{id:1,url:'https://a.com/',pinned:false},{id:2,url:'https://a.com/',active:true},{id:3,url:'https://a.com/',pinned:true},{id:4,url:'https://a.com/?x=1'},{id:5,url:'chrome://settings'}]),[2,1]);});
test('多个固定副本均受到保护',()=>assert.deepEqual(duplicateIds([{id:1,url:'https://a.com',pinned:true},{id:2,url:'https://a.com',pinned:true}]),[]));
test('拒绝脚本与浏览器内部网址',()=>{assert.equal(safeUrl('javascript:alert(1)'),false);assert.equal(safeUrl('https://example.com'),true);});
test('按收藏和关键词查找工具',()=>assert.equal(filterTools([{tool_id:'1',tool_name:'JSON',tool_desc:'格式化',site_name:'趁手'}],'json','收藏',['1']).length,1));
