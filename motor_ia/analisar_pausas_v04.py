import argparse, csv, json, sys
from pathlib import Path
import numpy as np


def main():
    p=argparse.ArgumentParser(description='Pipe Editor AI 0.4 - pausas por VAD e energia, sem editar video')
    p.add_argument('arquivo',help='Audio/video original (MP3, MOV etc.)')
    p.add_argument('--transcricao',default='',help='JSON anterior (opcional, para comparacao)')
    p.add_argument('--pausa-min',type=float,default=0.20)
    p.add_argument('--saida',default='resultado_v04')
    args=p.parse_args()
    if args.pausa_min<0.10: sys.exit('Use --pausa-min >= 0.10')
    origem=Path(args.arquivo)
    if not origem.is_file(): sys.exit(f'Arquivo nao encontrado: {origem}')
    try:
        from faster_whisper.audio import decode_audio
        from faster_whisper.vad import get_speech_timestamps, VadOptions
    except ImportError: sys.exit('Dependencia ausente: execute INSTALAR_MOTOR.bat da versao 0.3')
    print('Decodificando audio:',origem)
    audio=decode_audio(str(origem),sampling_rate=16000)
    dur=len(audio)/16000
    print(f'Duracao: {dur:.2f}s | Detectando atividade vocal...')
    # VAD identifica regiao vocal, nao garante que cada ruido vocal seja fala.
    op=VadOptions(threshold=0.50,min_speech_duration_ms=100,max_speech_duration_s=float('inf'),min_silence_duration_ms=120,speech_pad_ms=80)
    raw=get_speech_timestamps(audio,vad_options=op,sampling_rate=16000)
    fala=[]
    for item in raw:
        a=max(0,item['start']/16000);b=min(dur,item['end']/16000)
        if b>a:
            if fala and a<=fala[-1][1]:fala[-1][1]=max(b,fala[-1][1])
            else:fala.append([a,b])
    # RMS 20ms; reporta energia como evidência auxiliar, sem substituir o VAD.
    hop=320
    n=len(audio)//hop
    rms=np.sqrt(np.mean(np.asarray(audio[:n*hop],dtype=np.float32).reshape(n,hop)**2,axis=1)+1e-12) if n else np.array([])
    def energy(a,b):
        lo=max(0,int(a*16000/hop));hi=min(len(rms),int(np.ceil(b*16000/hop)))
        if hi<=lo:return None
        return round(float(20*np.log10(max(float(np.percentile(rms[lo:hi],90)),1e-6))),1)
    # Limites e lacunas da atividade vocal.
    gaps=[];cursor=0.
    for a,b in fala:
        if a-cursor>=args.pausa_min:gaps.append((cursor,a))
        cursor=max(cursor,b)
    if dur-cursor>=args.pausa_min:gaps.append((cursor,dur))
    pausas=[]
    for a,b in gaps:
        e=energy(a,b)
        # Energia alta pode indicar transito, musica, ruído, respiração etc.
        classe='REVISAO_RUIDO' if e is not None and e>-28 else 'CANDIDATA_PAUSA'
        pausas.append({'inicio':round(a,3),'fim':round(b,3),'duracao':round(b-a,3),'energia_p90_dbfs':e,'tipo':classe,'aprovada_para_corte':False})
    anteriores=[]
    if args.transcricao:
        t=Path(args.transcricao)
        if not t.is_file():sys.exit(f'Transcricao nao encontrada: {t}')
        data=json.loads(t.read_text(encoding='utf-8-sig'))
        anteriores=data.get('pausas_candidatas',[])
    out=Path(args.saida);out.parent.mkdir(parents=True,exist_ok=True)
    payload={'versao':'0.4-test','arquivo':str(origem.resolve()),'duracao_s':round(dur,3),'pausa_min_s':args.pausa_min,
             'observacoes':['Pausas detectadas pelo Silero VAD a partir do audio, nao dos segmentos Whisper.',
              'Energia RMS e indicador auxiliar, nao classificacao definitiva de ruido/fala.',
              'Nenhum intervalo e aprovado automaticamente para corte.',
              'Tempos relativos ao arquivo de audio; confira offset em relacao a timeline.'],
             'regioes_voz':[{'inicio':round(a,3),'fim':round(b,3)} for a,b in fala],
             'pausas_candidatas':pausas,'pausas_versao_03':anteriores}
    out.with_suffix('.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    with out.parent.joinpath(out.name+'_pausas.csv').open('w',newline='',encoding='utf-8-sig') as f:
        w=csv.DictWriter(f,fieldnames=['inicio','fim','duracao','energia_p90_dbfs','tipo','aprovada_para_corte'],delimiter=';');w.writeheader();w.writerows(pausas)
    print(f'CONCLUIDO: {len(fala)} regioes de voz; {len(pausas)} intervalos candidatos >= {args.pausa_min:.2f}s')
    print('Resultados:',out.with_suffix('.json'),out.parent.joinpath(out.name+'_pausas.csv'))
    print('NENHUM CORTE foi realizado.')
if __name__=='__main__':main()
