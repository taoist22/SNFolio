/* Run: TZ=UTC node tools/parser-evaluation/probe.cjs /path/to/evaluation/node_modules */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');
const deps = path.resolve(process.argv[2]);
const fixtures = require('./fixtures.cjs');
const ICAL = require(path.join(deps,'ical.js/dist/ical.es5.cjs'));
const nodeIcal = require(path.join(deps,'node-ical'));
const filename = path.resolve('src/domain/icsParser.ts');
const current = new Module(filename, module);
current.filename = filename; current.paths = Module._nodeModulePaths(path.dirname(filename));
const previousTsLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loaded, file) => loaded._compile(babel.transformFileSync(file).code, file);
current._compile(babel.transformFileSync(filename).code,filename);
if (previousTsLoader) require.extensions['.ts'] = previousTsLoader;
else delete require.extensions['.ts'];
function candidate(ICAL, f) {
 const root = new ICAL.Component(ICAL.parse(f.ics));
 const components = root.getAllSubcomponents('vevent');
 const master = components.find(c => !c.hasProperty('recurrence-id'));
 const e = new ICAL.Event(master);
 components.filter(c => c.hasProperty('recurrence-id')).forEach(c => e.relateException(new ICAL.Event(c)));
 const iterator = e.iterator(); const starts=[];
 for(let i=0;i<10;i++) { const next=iterator.next(); if(!next)break; starts.push(e.getOccurrenceDetails(next).startDate.toJSDate().toISOString()); }
 return {starts,zone:e.startDate.zone.tzid};
}
const results=fixtures.map(f=>{
 const events=current.exports.parseIcsContent(f.ics); const starts=new Set();
 for(let day=Date.UTC(2026,8,1);day<Date.UTC(2026,11,2);day+=86400000) {
  const instant=new Date(day); const localDay=new Date(instant.getFullYear(),instant.getMonth(),instant.getDate());
  current.exports.expandEventsForDate(events,localDay).forEach(e=>starts.add(e.start.toISOString()));
 }
 let ical;try{ical=candidate(ICAL,f);}catch(e){ical={error:e.message};}
 let node;try{node=Object.values(nodeIcal.sync.parseICS(f.ics)).filter(e=>e.type==='VEVENT').map(e=>e.start.toISOString());}catch(e){node={error:e.message};}
 return {name:f.name,expected:f.expected,current:[...starts].sort(),ical,nodeIcalInitial:node};
});
console.log(JSON.stringify(results,null,2));
// Same candidate probes executed in RN's bundled desktop Hermes, not a Node mock.
const hermesScript=fs.readFileSync(path.join(deps,'ical.js/dist/ical.es5.cjs'),'utf8')+'\n'+
 'var fixtures='+JSON.stringify(fixtures)+';\n'+candidate.toString()+
 '\nfixtures.forEach(function(f){try{print(JSON.stringify({name:f.name,result:candidate(ICAL,f)}));}catch(e){print(JSON.stringify({name:f.name,error:String(e)}));}});';
fs.writeFileSync(path.join(path.dirname(deps),'hermes-probe.js'),hermesScript);
