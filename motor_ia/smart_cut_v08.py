import argparse,csv,json,math,shutil,subprocess
from pathlib import Path
import numpy as np
from scipy.ndimage import uniform_filter1d

PROFILES={
 'suave':dict(min_gap=.34,keep=.24,pad=.11,min_cut=.10,quiet_db=5.0),
 'normal':dict(min_gap=.20,keep=.18,pad=.085,min_cut=.085,quiet_db=6.0),
 'agressivo':dict(min_gap=.17,keep=.15,pad=.065,min_cut=.08,quiet_db=8.0),
}

def merge(intervals,gap=0):
 out=[]
 for a,b in sorted(intervals):
  if b<=a:continue
  if out and a<=out[-1][1]+gap:out[-1][1]=max(out[-1][1],b)
  else:out.append([a,b])
 return out

def read_words(path,duration):
 d=json.loads(Path(path).read_text(encoding='utf-8-sig'))
 words=[]
 for block in d.get('blocos',[]):
  for w in block.get('palavras',[]):
   a=float(w.get('inicio',0));b=float(w.get('fim',0))
   if 0<=a<b<=duration+.25:words.append((max(0,a),min(duration,b),w.get('texto','')))
 if not words:raise ValueError('Nao ha timestamps validos em resultado.json')
 return sorted(words)

def energy_envelope(y,sr=16000,hop=.01):
 # 10 ms hops, RMS over ~30 ms. Use dBFS.
 h=round(sr*hop); n=(len(y)+h-1)//h
 padded=np.pad(y,(0,n*h-len(y)))
 e=np.mean(padded.reshape(n,h).astype(np.float64)**2,axis=1)
 e=uniform_filter1d(e,size=3,mode='nearest')
 return 10*np.log10(np.maximum(e,1e-12)),hop

def pick_cut(a,b,db,hop,config,noise_floor):
 # Word timestamps delimit safe region; local acoustics chooses quietest feasible cut.
 pad=config['pad']; keep=config['keep']; mincut=config['min_cut']
 a+=pad;b-=pad
 if b-a<keep+mincut:return None
 # protect words; remove center of interval, preserve half the remaining pause on each side
 left=a+keep/2;right=b-keep/2
 if right-left<mincut:return None
 # If central region contains strong acoustic activity, trim the edges to a quieter run.
 i=max(0,int(left/hop));j=min(len(db),int(math.ceil(right/hop)))
 if j<=i:return None
 chunk=db[i:j]
 # Quiet is relative to each clip's floor. A breath can be louder than ambient;
 # keep candidates but flag high-energy cuts for review instead of silently cutting words.
 threshold=min(-22.0,noise_floor+config['quiet_db'])
 quiet=chunk<=threshold
 runs=[];start=None
 for k,val in enumerate(quiet):
  if val and start is None:start=k
  if start is not None and (not val or k==len(quiet)-1):
   end=k if not val else k+1
   if (end-start)*hop>=mincut:runs.append((start,end))
   start=None
 if runs and float(np.mean(quiet))<0.70:
  # Prefer longest quiet stretch when the candidate contains substantial sound.
  start,end=max(runs,key=lambda r:r[1]-r[0])
  cuta=max(left,(i+start)*hop);cutb=min(right,(i+end)*hop)
  mode='ACUSTICO'
 else:
  # A region with substantial sound and no safe quiet run may contain a word tail.
  # Never cut through it automatically.
  if float(np.mean(quiet))<0.25:return None
  cuta=left;cutb=right;mode='REVISAR_RESPIRACAO_OU_RUIDO'
 if cutb-cuta<mincut:return None
 # Reject cuts whose first or last 50 ms are noticeably louder than the quiet floor.
 # This protects word endings and the onset of the next word from timestamp errors.
 edge_n=max(1,int(.05/hop))
 left_edge=db[max(0,int(cuta/hop)):min(len(db),int(cuta/hop)+edge_n)]
 right_edge=db[max(0,int(cutb/hop)-edge_n):min(len(db),int(cutb/hop))]
 edge_limit=min(-19.0,noise_floor+11.0)
 if (len(left_edge) and np.percentile(left_edge,75)>edge_limit) or (len(right_edge) and np.percentile(right_edge,75)>edge_limit):return None
 mean=float(np.mean(db[max(0,int(cuta/hop)):min(len(db),int(cutb/hop))]))
 return [round(cuta,3),round(cutb,3),mode,round(mean,1)]

def main():
 p=argparse.ArgumentParser(description='Pipe Editor AI 0.8 - pausas/respiracoes; nao remove palavras nem edita Premiere')
 p.add_argument('audio');p.add_argument('--transcricao',required=True)
 p.add_argument('--perfil',choices=PROFILES,default='normal')
 p.add_argument('--saida',default='resultado_v08');p.add_argument('--preview',action='store_true')
 args=p.parse_args();src=Path(args.audio);cfg=PROFILES[args.perfil]
 if not src.is_file():p.error('Audio nao encontrado')
 try:
  from faster_whisper.audio import decode_audio
  y=decode_audio(str(src),sampling_rate=16000)
  duration=len(y)/16000;words=read_words(args.transcricao,duration)
 except Exception as e:p.error(str(e))
 db,hop=energy_envelope(y);floor=float(np.percentile(db,20))
 occupied=merge([(a,b) for a,b,_ in words],gap=.01)
 gaps=[(b,c) for (_,b),(c,_) in zip(occupied,occupied[1:]) if c-b>=cfg['min_gap']]
 candidates=[];cuts=[]
 for a,b in gaps:
  selected=pick_cut(a,b,db,hop,cfg,floor)
  if selected:
   ca,cb,mode,energy=selected
   cuts.append((ca,cb))
   candidates.append({'pausa_inicio':round(a,3),'pausa_fim':round(b,3),'pausa_duracao':round(b-a,3),'corte_inicio':ca,'corte_fim':cb,'corte_duracao':round(cb-ca,3),'criterio':mode,'energia_dbfs':energy})
 cuts=merge(cuts);kept=[];pos=0
 for a,b in cuts:
  if a>pos:kept.append([pos,a])
  pos=b
 if duration>pos:kept.append([pos,duration])
 removed=sum(b-a for a,b in cuts)
 out=Path(args.saida);out.parent.mkdir(parents=True,exist_ok=True)
 payload={'versao':'0.8-protecao-palavras','audio':str(src.resolve()),'perfil':args.perfil,'duracao_original_s':round(duration,3),'palavras_validas':len(words),'pausas_examinadas':len(gaps),'cortes_sugeridos':len(cuts),'cortes_revisar':sum(c['criterio'].startswith('REVISAR') for c in candidates),'tempo_removido_s':round(removed,3),'duracao_prevista_s':round(duration-removed,3),'cortes_remover':[{'inicio':round(a,3),'fim':round(b,3),'duracao':round(b-a,3)} for a,b in cuts],'candidatas_detalhes':candidates,'trechos_manter':[{'inicio':round(a,3),'fim':round(b,3)} for a,b in kept],'avisos':['Somente pausas entre palavras reconhecidas; nao remove palavras intencionalmente.','Timestamps Whisper podem estar errados: confira o preview.','0.8 adiciona margem de seguranca de palavras e rejeita bordas acusticamente ativas.','Ainda nao modifica o Premiere.']}
 out.with_suffix('.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
 with out.parent.joinpath(out.name+'_cortes.csv').open('w',newline='',encoding='utf-8-sig') as f:
  w=csv.writer(f,delimiter=';');w.writerow(['inicio_s','fim_s','duracao_s','criterio','energia_dbfs'])
  for c in candidates:w.writerow([c['corte_inicio'],c['corte_fim'],c['corte_duracao'],c['criterio'],c['energia_dbfs']])
 print('Cortes:',len(cuts),'| Tempo removido:',round(removed,2),'s | Revisar:',payload['cortes_revisar'])
 if args.preview:
  ff=shutil.which('ffmpeg')
  if not ff:print('FFmpeg ausente: nao foi possivel gerar preview.')
  else:
   filt=[f'[0:a]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS[a{i}]' for i,(a,b) in enumerate(kept)]
   filt.append(''.join(f'[a{i}]' for i in range(len(kept)))+f'concat=n={len(kept)}:v=0:a=1[out]')
   target=out.parent.joinpath(out.name+'_preview.mp3')
   try:
    subprocess.run([ff,'-hide_banner','-loglevel','error','-y','-i',str(src),'-filter_complex',';'.join(filt),'-map','[out]','-codec:a','libmp3lame','-q:a','3',str(target)],check=True)
    print('Preview:',target)
   except Exception as e:print('Falha ao criar preview:',e)
 print('JSON:',out.with_suffix('.json'),'| Nenhum projeto Premiere foi alterado.')
if __name__=='__main__':main()
