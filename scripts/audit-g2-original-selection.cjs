const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),z=require('node:zlib'),assert=require('node:assert/strict');
const out='docs/evidence/g2-010-attempt-2',base='990a930bb0c372ea66f7cbc485d9dea8e414c9af',git=(...a)=>cp.execFileSync('git',a,{encoding:'utf8'}).trim(),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const old=JSON.parse(fs.readFileSync('docs/evidence/g2-010/audit.json'));
const audit={taskId:'G2-010',attempt:2,dispatchKey:'G2-010-attempt-2',baseline:base,head:git('rev-parse','HEAD'),time:new Date().toISOString(),protectedFiles:[],fixtures:[],unchangedDependencies:[],reusedEvidence:[],checkedHistoricalArchives:0,newEvidence:[],sources:[]};
for(const r of old.protectedFiles){assert.equal(git('hash-object',r.file),r.gitBlob);audit.protectedFiles.push(r);}
for(const r of old.fixtures){assert.equal(git('hash-object',r.path),r.gitBlob);assert.equal(sha(fs.readFileSync(r.path)),r.workingBytesSha256);audit.fixtures.push(r);}
const dependencies=git('ls-tree','-r','--name-only',base,'src/core','src/adapters').split('\n').filter(Boolean);
for(const file of dependencies){const blob=git('rev-parse',`${base}:${file}`);assert.equal(git('hash-object',file),blob);audit.unchangedDependencies.push({file,blob});}
for(const n of ['migration-storage','recovery-storage','replace-storage','import-storage','export-storage','slots-storage']){
 const file=`docs/evidence/g2-010/final-native-${n}/result.json`,r=JSON.parse(fs.readFileSync(file));assert.equal(r.status,'passed');assert.equal(git('hash-object',file),git('rev-parse',`${base}:${file}`));audit.reusedEvidence.push({file,checks:r.checks.length,sha256:sha(fs.readFileSync(file)),reason:'Core and all adapters byte-identical to product baseline; not rerun'});
}
const oldProduct='docs/evidence/g2-010/old-first/result.json',previous=JSON.parse(fs.readFileSync(oldProduct));assert.equal(previous.status,'passed');assert.equal(git('hash-object',oldProduct),git('rev-parse',`${base}:${oldProduct}`));assert.equal(sha(fs.readFileSync(previous.newFixture)),previous.newFixtureHash);
audit.reusedEvidence.push({file:oldProduct,oldRef:previous.oldRef,sha256:sha(fs.readFileSync(oldProduct)),reason:'Fixed old product and unchanged new Core/codec/storage/fixture; old UI compatibility evidence reused, not a new full-current-UI rerun'});
for(const r of old.archives){const bytes=fs.readFileSync(r.target),raw=r.target.endsWith('.gz')&&!r.source.endsWith('.gz')?z.gunzipSync(bytes):bytes;assert.equal(raw.length,r.bytes);assert.equal(sha(raw),r.sha256);audit.checkedHistoricalArchives++;}
assert.equal(git('rev-parse','g1-verified^{}'),'f532997dc20c7490d00e29ab430269f5748135f1');audit.stableGate='G1';
assert.equal(git('hash-object','docs/pm/reports/G2-010-attempt-1.md'),git('rev-parse','7abb8bc09f2163f93948dd1ad1b8cd1aac8375cf:docs/pm/reports/G2-010-attempt-1.md'));
const red=JSON.parse(fs.readFileSync(`${out}/browser-red/result.json`));assert.equal(red.status,'failed');assert.match(red.error,/false !== true/);assert.equal(red.distSource,base);assert.equal(red.servicesClosed,true);
const green=JSON.parse(fs.readFileSync(`${out}/browser-green/result.json`));assert.equal(green.status,'passed');assert.equal(green.servicesClosed,true);assert.equal(green.runs.length,2);
for(const a of green.artifacts)assert.equal(sha(fs.readFileSync(a.file)),a.sha256);
for(const s of green.sourceFiles)assert.equal(git('hash-object',s.file),s.blob);
for(const run of green.runs){assert.equal(run.downloads.length,4);for(const d of run.downloads)assert.equal(sha(fs.readFileSync(`${out}/browser-green/${d.file}`)),d.sha256);}
for(const name of ['contact-feedback','migration-feedback']){
 const source=`.superpowers/sdd/g2-010-attempt-2/${name}`,target=`${out}/${name}`;fs.mkdirSync(target,{recursive:true});const r=JSON.parse(fs.readFileSync(`${source}/result.json`));assert.equal(r.status,'passed');
 for(const s of r.sourceFiles)assert.equal(git('hash-object',s.file),s.gitBlob);
 for(const a of r.artifacts)assert.equal(sha(fs.readFileSync(path.join(source,a.file))),a.sha256);
 fs.copyFileSync(`${source}/result.json`,`${target}/result.json`);
 for(const run of r.runs)for(const file of run.screenshots)fs.copyFileSync(`${source}/${file}`,`${target}/${file}`);
}
for(const file of fs.readdirSync(out).filter(f=>f.endsWith('.log'))){const bytes=fs.readFileSync(`${out}/${file}`);fs.writeFileSync(`${out}/${file}.gz`,z.gzipSync(bytes));assert.deepEqual(z.gunzipSync(fs.readFileSync(`${out}/${file}.gz`)),bytes);}
const tracked=git('ls-files','src','index.html','package.json','package-lock.json','vite.config.ts').split('\n').filter(Boolean);
for(const file of [...tracked,'scripts/verify-g2-original-selection.cjs','scripts/audit-g2-original-selection.cjs'])audit.sources.push({file,blob:git('hash-object',file)});
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else if(e.name!=='audit.json'&&!e.name.endsWith('.log'))audit.newEvidence.push({file,sha256:sha(fs.readFileSync(file)),bytes:fs.statSync(file).size});}}walk(out);
fs.writeFileSync(`${out}/audit.json`,JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify({status:'passed',protected:audit.protectedFiles.length,fixtures:audit.fixtures.length,unchangedDependencies:audit.unchangedDependencies.length,historicalArchives:audit.checkedHistoricalArchives,newEvidence:audit.newEvidence.length,sources:audit.sources.length}));
