// Import one complete language export into the repository JSON catalogs.
const fs=require('node:fs');
const path=require('node:path');
const categories=['interface','food','types'];
const header=['language_code','category','key','source','translation'];
function parseCsv(text){
 const rows=[];let row=[],field='',quoted=false,closed=false;
 text=text.replace(/^\uFEFF/,'');
 for(let index=0;index<text.length;index++){
  const char=text[index];
  if(quoted){
   if(char==='"'&&text[index+1]==='"'){field+='"';index++;}
   else if(char==='"'){quoted=false;closed=true;}
   else field+=char;
  }else if(char===','||char==='\n'||char==='\r'){
   row.push(field);field='';closed=false;
   if(char!==','){
    if(char==='\r'&&text[index+1]==='\n')index++;
    if(row.some(value=>value!==''))rows.push(row);
    row=[];
   }
  }else if(char==='"'&&!field&&!closed)quoted=true;
  else{
   if(closed||char==='"')throw Error('Invalid CSV quoting');
   field+=char;
  }
 }
 if(quoted)throw Error('Unclosed CSV quote');
 if(field||row.length){row.push(field);if(row.some(value=>value!==''))rows.push(row);}
 return rows;
}
function flatten(value,prefix='',output={}){
 for(const [key,child] of Object.entries(value)){
  const name=prefix?prefix+'.'+key:key;
  if(typeof child==='string')output[name]=child;else flatten(child,name,output);
 }
 return output;
}
const placeholders=text=>[...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match=>match[1]).sort().join(',');
function importLanguageCsv(text,root=process.cwd()){
 const rows=parseCsv(text);
 if(JSON.stringify(rows.shift())!==JSON.stringify(header))throw Error('Expected CSV columns '+header.join(','));
 if(!rows.length)throw Error('The CSV contains no translations');
 const language=rows[0][0];
 if(!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language)||language.length>16||Intl.getCanonicalLocales(language)[0]!==language)throw Error('Invalid language code');
 const aliases=JSON.parse(fs.readFileSync(path.join(root,'locales/aliases.json'),'utf8'));
 const sources=new Map(Object.entries(aliases).map(([source,key])=>[key,source]));
 const catalogs=Object.fromEntries(categories.map(category=>[category,JSON.parse(fs.readFileSync(path.join(root,'locales/en',category+'.json'),'utf8'))]));
 const expected=new Set(categories.flatMap(category=>Object.keys(flatten(catalogs[category])).map(key=>category+'.'+key)));
 const seen=new Set();
 for(const [index,row] of rows.entries()){
  const [code,category,key,source,value]=row,fullKey=category+'.'+key;
  if(row.length!==header.length||code!==language||!expected.has(fullKey)||sources.get(fullKey)!==source||seen.has(fullKey))throw Error('Invalid or duplicate translation at CSV row '+(index+2));
  if(value.length>12000||(language==='en'&&!value.trim())||(value.trim()&&placeholders(value)!==placeholders(source)))throw Error('Invalid text or placeholders at CSV row '+(index+2));
  seen.add(fullKey);
  const parts=key.split('.');let target=catalogs[category];
  for(const part of parts.slice(0,-1))target=target[part];
  target[parts.at(-1)]=value;
 }
 if(seen.size!==expected.size)throw Error('Missing translation keys. Import a complete language CSV export.');
 const directory=path.join(root,'locales',language);fs.mkdirSync(directory,{recursive:true});
 const files=[];
 for(const category of categories){
  const destination=path.join(directory,category+'.json'),temporary=destination+'.'+process.pid+'.tmp';
  try{
   fs.writeFileSync(temporary,JSON.stringify(catalogs[category],null,2)+'\n',{flag:'wx'});
   fs.renameSync(temporary,destination);files.push(destination);
  }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
 }
 return {language,files};
}
module.exports={parseCsv,importLanguageCsv};
if(require.main===module){
 try{
  if(process.argv.length!==3)throw Error('Usage: node tools/import-language-csv.cjs LANGUAGE.csv');
  const result=importLanguageCsv(fs.readFileSync(process.argv[2],'utf8'));
  process.stdout.write('Imported '+result.language+' into '+result.files.length+' locale JSON files. Run node tools/validate-locales.cjs, review the diff and open a pull request.\n');
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
