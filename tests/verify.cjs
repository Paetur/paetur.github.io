// Public build verification. Uses local files and synthetic DOM fixtures only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),site=path.join(root,'_site');
const paths=[];function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else paths.push(path.relative(site,file));}}walk(site);
assert.deepEqual(paths.sort(),['.nojekyll','CNAME','assets/site.css','hk-bussar/index.html','index.html','iphone/data.json','iphone/index.html','rsvp-overview/data.json','rsvp-overview/index.html'].sort());
const home=fs.readFileSync(path.join(site,'index.html'),'utf8');
for(const route of ['iphone/','hk-bussar/','rsvp-overview/']){assert.ok(home.includes('href="'+route+'"'));assert.ok(fs.existsSync(path.join(site,route,'index.html')));}
assert.equal(fs.readFileSync(path.join(site,'CNAME'),'utf8').trim(),'github.notin.fo');
const data=JSON.parse(fs.readFileSync(path.join(site,'rsvp-overview/data.json'),'utf8'));
assert.equal(data.project,'RSVP Manager');assert.equal(data.modules.length,14);assert.ok(data.maturity>=0&&data.maturity<=100);assert.ok(data.readiness>=0&&data.readiness<=100);
assert.equal(data.sourceURL,'https://github.com/Paetur/RSVP-Manager');
for(const file of paths.filter(p=>p.endsWith('.html'))){const text=fs.readFileSync(path.join(site,file),'utf8');assert.ok(text.includes('name="viewport"'));assert.ok(!/\b(?:src|href)="http:\/\//.test(text),file+' must not use HTTP assets/links');for(const script of text.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);}
const result=cp.spawnSync(process.execPath,['verify.cjs'],{cwd:path.join(root,'projects/iphone'),encoding:'utf8'});assert.equal(result.status,0,result.stderr);process.stdout.write(result.stdout);
console.log('PASS public site: three project links, exact artifact allowlist, working module data, HTTPS links, valid scripts and unchanged iPhone filters.');
