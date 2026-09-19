import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');
export async function buildCompanion(out){
 await mkdir(out,{recursive:true});
 for(const name of ['manifest.json','config.mjs','capture.mjs','yahoo-capture.mjs','league-capture.mjs','bundle.mjs','worker.mjs','popup.mjs','popup.html','popup.css','sidepanel.html'])await copyFile(join(here,name),join(out,name));
 await build({entryPoints:[join(here,'sidebar-entry.tsx')],bundle:true,outfile:join(out,'sidepanel.js'),format:'esm',platform:'browser',target:'chrome120',jsx:'automatic',minify:true,
  alias:{'@':join(root,'apps/web/src')},tsconfig:join(root,'apps/web/tsconfig.app.json'),define:{'process.env.NODE_ENV':'"production"','import.meta.env.VITE_NATIVE':'"0"'}});
 const css=await postcss([tailwind({content:[join(root,'apps/web/src/components/draftkit/**/*.{ts,tsx}'),join(here,'sidebar-entry.tsx')],theme:{extend:{fontFamily:{barlow:['Arial','sans-serif']},zIndex:{sheet:'100'}}},plugins:[]})]).process(await readFile(join(here,'sidebar.css'),'utf8'),{from:join(here,'sidebar.css')});
 const componentCss=await readFile(join(out,'sidepanel.css'),'utf8');
 await writeFile(join(out,'sidepanel.css'),css.css+'\n'+componentCss);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const out=process.argv[2];if(!out)throw Error('Pass a dedicated extension output directory.');
 await buildCompanion(resolve(out));console.log('Built companion at '+resolve(out));
}
