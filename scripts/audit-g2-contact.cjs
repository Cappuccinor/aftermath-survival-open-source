const fs=require('fs'),path=require('path'),crypto=require('crypto'),z=require('zlib'),cp=require('child_process'),assert=require('assert/strict');
const root='.superpowers/sdd/2026-10-26-g2-010',out='docs/evidence/g2-010';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),git=(...a)=>cp.execFileSync('git',a,{encoding:'utf8'}).trim();
const audit={taskId:'G2-010',attempt:1,dispatchKey:'G2-010-attempt-1',base:'6dac4b4613eb9708adc081ed3d2564250ec59a90',sourceHead:git('rev-parse','HEAD'),time:new Date().toISOString(),archives:[],sourceMatches:[],protectedFiles:[],fixtures:[],sets:[],limitations:['No physical power loss, true full disk, process kill recovery, real mobile device, cross-browser, screen reader, system picker or long-term performance claim','No hosted CI/tag/push/merge; full G2 remains partial','Old source archive/profile and failed artifacts retained under .superpowers, not deleted']};
function retain(source,destination){const bytes=fs.readFileSync(source),target=path.join(out,destination);fs.mkdirSync(path.dirname(target),{recursive:true});if(/\.(png|gz)$/.test(source)){fs.copyFileSync(source,target);audit.archives.push({source,target,sha256:hash(bytes),bytes:bytes.length});}else{fs.writeFileSync(target+'.gz',z.gzipSync(bytes));assert.deepEqual(z.gunzipSync(fs.readFileSync(target+'.gz')),bytes);audit.archives.push({source,target:target+'.gz',sha256:hash(bytes),bytes:bytes.length});}}
const sets=['public-first','public-second','old-first','contact-feedback','migration-feedback',...['migration-storage','recovery-storage','replace-storage','import-storage','export-storage','slots-storage'].map(s=>'final-native-'+s)];
for(const name of sets){const folder=path.join(root,name),r=JSON.parse(fs.readFileSync(path.join(folder,'result.json'),'utf8'));fs.mkdirSync(path.join(out,name),{recursive:true});fs.copyFileSync(path.join(folder,'result.json'),path.join(out,name,'result.json'));audit.sets.push({name,status:r.status,runs:r.runs?.map(x=>({viewport:x.viewport,checks:x.checks?.length,downloads:x.downloads?.length,screenshots:x.screenshots?.length})),checks:r.checks?.length});
 if(name!=='public-first')assert.equal(r.status,'passed');
 for(const row of r.sourceFiles??[]){const current=git('hash-object','--',row.file);if(name!=='public-first')assert.equal(current,row.gitBlob,`${name} source drift ${row.file}`);audit.sourceMatches.push({set:name,file:row.file,recorded:row.gitBlob,current,match:current===row.gitBlob});}
 if(name==='public-second')for(const a of r.artifacts){assert.equal(hash(fs.readFileSync(path.join('dist',a.file))),a.sha256,'production artifact changed');}
 const relative=fs.readdirSync(folder,{recursive:true}).filter(f=>fs.statSync(path.join(folder,f)).isFile()&&!f.startsWith('profile')&&!f.startsWith('old-source')&&!f.endsWith('result.json'));
 for(const f of relative){if(/\.(png|json|js|css|html)$/.test(f))retain(path.join(folder,f),path.join(name,f));}
}
for(const name of fs.readdirSync(out).filter(f=>f.endsWith('.log')))retain(path.join(out,name),path.join('logs',name));
const prior=JSON.parse(fs.readFileSync('docs/evidence/g2-009/audit.json','utf8'));
for(const row of prior.fixtures){const actual=hash(fs.readFileSync(row.path));assert.equal(actual,row.workingBytesSha256);audit.fixtures.push({...row,checked:true});}
const protectedPaths=git('ls-tree','-r','--name-only',audit.base,'src/tests').split(/\r?\n/).filter(f=>f.endsWith('.test.ts'));
protectedPaths.push('package.json','package-lock.json','vitest.config.ts','tsconfig.json','tsconfig.core.json','.github/workflows/ci.yml','AGENTS.md','docs/00_PRODUCT_CONSTITUTION.md','docs/07_ROADMAP_GATES.md');
for(const file of protectedPaths){const baseline=git('rev-parse',audit.base+':'+file),actual=git('hash-object','--',file);assert.equal(actual,baseline,`protected ${file}`);audit.protectedFiles.push({file,gitBlob:actual});}
audit.stableTag=git('rev-parse','g1-verified^{}');assert.equal(audit.stableTag,'f532997dc20c7490d00e29ab430269f5748135f1');
audit.changedFiles=git('diff','--name-only',audit.base,'--','.').split(/\r?\n/).filter(f=>f!=='docs/pm/LOOP_STATE.json');
fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify({sets:audit.sets,sourceRecords:audit.sourceMatches.length,protected:audit.protectedFiles.length,fixtures:audit.fixtures.length,archives:audit.archives.length}));
