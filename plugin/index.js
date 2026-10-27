const { entrypoints } = require('uxp');
entrypoints.setup({panels:{pipeEditorPanel:{show(){console.log('Pipe Editor AI 0.2 aberto');}}}});
const button = document.getElementById('readButton');
const status = document.getElementById('status');
const summary = document.getElementById('summary');
const tracks = document.getElementById('tracks');
const fmt = n => Number.isFinite(n) ? n.toFixed(2)+' s' : 'indisponível';
const safe = value => String(value ?? 'sem nome');
function line(parent, cls, value){ const el=document.createElement('div');el.className=cls;el.textContent=value;parent.appendChild(el); }
async function scanTrack(app,seq,kind,index){
 const tr=kind==='V'?await seq.getVideoTrack(index):await seq.getAudioTrack(index);
 const heading=`${kind}${index+1} · ${safe(tr.name)}`;
 const box=document.createElement('div');box.className='track';
 line(box,'',heading);
 const items=await tr.getTrackItems(app.Constants.TrackItemType.CLIP,false);
 if(!items.length)line(box,'clip','Nenhum clipe.');
 for(const item of items){
   const [name,start,end,duration]=await Promise.all([item.getName(),item.getStartTime(),item.getEndTime(),item.getDuration()]);
   line(box,'clip',`${safe(name)} | início ${fmt(start.seconds)} | fim ${fmt(end.seconds)} | duração ${fmt(duration.seconds)}`);
 }
 tracks.appendChild(box);
 return items.length;
}
button.addEventListener('click',async()=>{
 button.disabled=true;status.textContent='Consultando o Premiere...';summary.textContent='';tracks.textContent='';
 try{
   const app=require('premierepro');
   const project=await app.Project.getActiveProject();
   if(!project)throw new Error('Nenhum projeto ativo. Abra um projeto no Premiere.');
   const seq=await project.getActiveSequence();
   if(!seq)throw new Error('Nenhuma sequência ativa. Abra a timeline da entrevista.');
   const [vCount,aCount,end,size]=await Promise.all([seq.getVideoTrackCount(),seq.getAudioTrackCount(),seq.getEndTime(),seq.getFrameSize()]);
   line(summary,'',`Projeto: ${safe(project.name)}`);
   line(summary,'',`Sequência: ${safe(seq.name)}`);
   line(summary,'',`Duração: ${fmt(end.seconds)}`);
   line(summary,'',`Quadro: ${safe(size.width)} × ${safe(size.height)}`);
   line(summary,'',`Faixas: ${vCount} de vídeo, ${aCount} de áudio`);
   let total=0;
   for(let i=0;i<vCount;i++)total+=await scanTrack(app,seq,'V',i);
   for(let i=0;i<aCount;i++)total+=await scanTrack(app,seq,'A',i);
   status.textContent=`Leitura concluída: ${total} clipe(s). Nenhum arquivo ou corte foi alterado.`;
 }catch(err){status.textContent='Erro ao ler: '+(err&&err.message?err.message:String(err));console.error(err);}
 finally{button.disabled=false;}
});
