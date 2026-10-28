import argparse, csv, json
from pathlib import Path

def load(path):
    d=json.loads(Path(path).read_text(encoding='utf-8'))
    return d,sorted(d['cortes_aproximados'],key=lambda x:x['intervalo_original_aproximado'][0])

def overlap(a,b):
    return max(0,min(a[1],b[1])-max(a[0],b[0]))

def main():
    p=argparse.ArgumentParser(description='Compara intervalos aproximados de calibracao, NAO gera cortes aplicaveis.')
    p.add_argument('manual_json');p.add_argument('ia_json');p.add_argument('--saida',default='comparacao_1_1')
    a=p.parse_args();dm,m=load(a.manual_json);di,ia=load(a.ia_json)
    out=Path(a.saida);out.mkdir(parents=True,exist_ok=True)
    rows=[]; matched_ia=set()
    for n,item in enumerate(m,1):
        interval=item['intervalo_original_aproximado']; hits=[]
        for j,c in enumerate(ia):
            other=c['intervalo_original_aproximado'];ov=overlap(interval,other)
            if ov>0: hits.append((j,ov,c))
        if hits:
            best=max(hits,key=lambda x:x[1]);matched_ia.add(best[0]);state='CORRESPONDENCIA_APROXIMADA';ref=best[2]['intervalo_original_aproximado'];ov=best[1]
        else:state='NAO_LOCALIZADO_NA_IA';ref=None;ov=0
        rows.append({'id':n,'inicio_original_aprox_s':interval[0],'fim_original_aprox_s':interval[1], 'removido_manual_estimado_s':item['duracao_removida_estimada_s'],'similaridade_ancoras':item['confianca_ancoras'],'situacao':state,'intervalo_ia_aprox':ref,'sobreposicao_s':round(ov,3)})
    missed=[r for r in rows if r['situacao']=='NAO_LOCALIZADO_NA_IA']
    extra=[{'intervalo_original_aproximado':x['intervalo_original_aproximado'],'duracao_removida_estimada_s':x['duracao_removida_estimada_s']} for j,x in enumerate(ia) if j not in matched_ia]
    summary={'metodo':'Intersecao de intervalos amplos entre ancoras. Diagnostico aproximado, NAO valida os limites de cortes.','manual':{'duracao_original_s':dm['duracao_original_s'],'duracao_editada_s':dm['duracao_manual_s'],'removido_s':dm['tempo_total_removido_s'],'candidatos':len(m)},'ia_08':{'duracao_editada_s':di['duracao_manual_s'],'removido_s':di['tempo_total_removido_s'],'candidatos':len(ia)},'diferenca_remocao_s':round(dm['tempo_total_removido_s']-di['tempo_total_removido_s'],3),'candidatos_manuais_com_correspondencia_aproximada':len(rows)-len(missed),'candidatos_manuais_sem_correspondencia_aproximada':len(missed),'candidatos_ia_sem_correspondencia_aproximada':len(extra),'candidatos_ia_nao_pareados':extra,'comparacao':rows,'alertas':['A largura dos intervalos entre ancoras NAO corresponde a duracao exata do corte.','Intervalos candidatos podem agregar mais de um corte ou refletir erros de alinhamento.','Nao aplicar esses intervalos na timeline; refinar limites com audio e protecao de palavras antes.']}
    (out/'comparacao.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    with (out/'comparacao.csv').open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]) if rows else ['id'],delimiter=';');w.writeheader();w.writerows(rows)
    print('Manual:',len(m),'candidatos | IA:',len(ia),'candidatos')
    print('Correspondencias aproximadas:',len(rows)-len(missed),'| Sem correspondencia:',len(missed))
    print('Arquivos:',out.resolve())
if __name__=='__main__':main()
