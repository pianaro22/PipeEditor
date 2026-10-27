import argparse, csv, json, math, subprocess, shutil
from pathlib import Path
import numpy as np

def merge(ranges, gap=0):
    out=[]
    for a,b in sorted(ranges):
        if b<=a:continue
        if out and a<=out[-1][1]+gap:out[-1][1]=max(b,out[-1][1])
        else:out.append([a,b])
    return out

def main():
    p=argparse.ArgumentParser(description='Pipe Editor AI 0.5 - plano de cortes de pausas, sem alterar Premiere')
    p.add_argument('audio')
    p.add_argument('--transcricao',default='',help='resultado.json da versao 0.3 (recomendado)')
    p.add_argument('--perfil',choices=['suave','normal','agressivo'],default='normal')
    p.add_argument('--saida',default='resultado_v05')
    p.add_argument('--preview',action='store_true',help='gera MP3 de teste usando ffmpeg, se instalado')
    args=p.parse_args()
    from faster_whisper.audio import decode_audio
    from faster_whisper.vad import get_speech_timestamps, VadOptions
    src=Path(args.audio)
    if not src.is_file():p.error('Arquivo de audio nao encontrado')
    y=decode_audio(str(src),sampling_rate=16000);duration=len(y)/16000
    config={'suave':(.48,.38,.25),'normal':(.38,.26,.18),'agressivo':(.30,.18,.12)}
    min_gap,keep,pad=config[args.perfil]
    raw=get_speech_timestamps(y,vad_options=VadOptions(threshold=.50,min_speech_duration_ms=100,min_silence_duration_ms=100,speech_pad_ms=35),sampling_rate=16000)
    speech=merge([(r['start']/16000,r['end']/16000) for r in raw])
    words=[]
    if args.transcricao:
        d=json.loads(Path(args.transcricao).read_text(encoding='utf-8-sig'))
        for seg in d.get('blocos',[]):
            for w in seg.get('palavras',[]):
                a=float(w.get('inicio',0));b=float(w.get('fim',0))
                if b>a and b<=duration+.25:words.append((a,b,w.get('texto','')))
    words.sort()
    # Para evitar cortar uma palavra: intersecao entre lacunas de VAD e lacunas entre palavras.
    # Sem transcricao: apenas VAD, com margem de seguranca maior.
    occupied=merge([(a,b) for a,b,_ in words],gap=.045) if words else []
    vad_gaps=[];prev=0.
    for a,b in speech:
        if a>prev:vad_gaps.append((prev,a))
        prev=max(prev,b)
    if duration>prev:vad_gaps.append((prev,duration))
    word_gaps=[]
    if occupied:
        prev=0.
        for a,b in occupied:
            if a>prev:word_gaps.append((prev,a))
            prev=max(prev,b)
        if duration>prev:word_gaps.append((prev,duration))
    else:word_gaps=[(0.,duration)]
    candidates=[]
    for va,vb in vad_gaps:
        for wa,wb in word_gaps:
            a=max(va,wa);b=min(vb,wb)
            if b-a>=min_gap:
                candidates.append((a,b))
    candidates=merge(candidates)
    # Cada corte deixa uma pequena pausa no centro e preserva margem nas bordas.
    # Inicio/fim do arquivo nao sao removidos automaticamente.
    cuts=[]
    for a,b in candidates:
        if a<.08 or b>duration-.08:continue
        extra_pad=pad if words else max(pad,.22)
        cut_start=a+extra_pad+keep/2
        cut_end=b-extra_pad-keep/2
        if cut_end-cut_start<.10:continue
        cuts.append([round(cut_start,3),round(cut_end,3)])
    cuts=merge(cuts)
    kept=[];pos=0.
    for a,b in cuts:
        if a>pos:kept.append([round(pos,3),round(a,3)])
        pos=b
    if duration>pos:kept.append([round(pos,3),round(duration,3)])
    removed=sum(b-a for a,b in cuts)
    output=Path(args.saida);output.parent.mkdir(parents=True,exist_ok=True)
    data={'versao':'0.5-preview','audio':str(src.resolve()),'duracao_original_s':round(duration,3),'perfil':args.perfil,'palavras_validas':len(words),'regioes_vad':len(speech),'pausas_candidatas':len(candidates),'cortes_sugeridos':len(cuts),'tempo_removido_s':round(removed,3),'duracao_prevista_s':round(duration-removed,3),'cortes_remover': [{'inicio':a,'fim':b,'duracao':round(b-a,3)} for a,b in cuts], 'trechos_manter':[{'inicio':a,'fim':b} for a,b in kept], 'avisos':['PROTOTIPO: nenhum corte foi feito no Premiere.','Os tempos sao relativos ao audio de entrada, nao a timeline.','VAD pode falhar em ruido/respiracoes; revise o resultado.','Para maior seguranca forneca --transcricao resultado.json.','O preview MP3 nao preserva sincronismo com video; serve apenas para escutar.']}
    output.with_suffix('.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    with output.parent.joinpath(output.name+'_cortes.csv').open('w',newline='',encoding='utf-8-sig') as f:
        w=csv.writer(f,delimiter=';');w.writerow(['inicio_remover_s','fim_remover_s','duracao_s'])
        for a,b in cuts:w.writerow([a,b,round(b-a,3)])
    print('Duracao:',round(duration,2),'s | Palavras:',len(words),'| Pausas candidatas:',len(candidates),'| Cortes sugeridos:',len(cuts),'| Remover:',round(removed,2),'s')
    print('JSON:',output.with_suffix('.json'))
    if args.preview:
        ff=shutil.which('ffmpeg')
        if not ff:print('PREVIEW nao gerado: ffmpeg nao encontrado no PATH. JSON/CSV foram gerados.')
        elif len(kept)>1000:print('PREVIEW nao gerado: trechos demais.')
        else:
            # concatena PCM no dominio temporal via filtro ffmpeg; WAV temporario nao necessario.
            filt=[]
            for i,(a,b) in enumerate(kept):filt.append(f'[0:a]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS[a{i}]')
            filt.append(''.join(f'[a{i}]' for i in range(len(kept)))+f'concat=n={len(kept)}:v=0:a=1[out]')
            target=output.parent.joinpath(output.name+'_preview.mp3')
            cmd=[ff,'-hide_banner','-loglevel','error','-y','-i',str(src),'-filter_complex',';'.join(filt),'-map','[out]','-codec:a','libmp3lame','-q:a','3',str(target)]
            try:
                subprocess.run(cmd,check=True);print('Preview:',target)
            except Exception as e:print('Preview nao gerado:',e)
    print('Nenhum arquivo do Premiere foi alterado.')
if __name__=='__main__':main()
