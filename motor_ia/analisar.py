import argparse
import csv
import json
import sys
from pathlib import Path

def main():
    p = argparse.ArgumentParser(description="Pipe Editor AI - análise de fala e pausas (somente leitura)")
    p.add_argument("arquivo", help="Vídeo/áudio da Câmera 1")
    p.add_argument("--modelo", default="small", choices=["tiny","base","small","medium","large-v3"])
    p.add_argument("--idioma", default="pt")
    p.add_argument("--pausa-min", type=float, default=0.65)
    p.add_argument("--saida", default="resultado")
    args = p.parse_args()
    origem = Path(args.arquivo)
    if not origem.is_file():
        sys.exit(f"Arquivo não encontrado: {origem}")
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("Instale as dependências com INSTALAR_MOTOR.bat")
    # CPU int8 é o modo inicial mais compatível. GPU será habilitada após validar CUDA/cuDNN.
    print("Carregando modelo; a primeira execução pode baixar arquivos da internet...")
    model = WhisperModel(args.modelo, device="cpu", compute_type="int8")
    print("Analisando:", origem)
    segments, info = model.transcribe(str(origem), language=args.idioma,
                                       vad_filter=True, word_timestamps=True,
                                       condition_on_previous_text=False)
    blocos = []
    for s in segments:
        palavras = [{"inicio": round(w.start,3), "fim": round(w.end,3),
                     "texto": w.word.strip()} for w in (s.words or [])]
        blocos.append({"inicio":round(s.start,3),"fim":round(s.end,3),
                       "texto":s.text.strip(),"palavras":palavras})
    pausas = []
    for anterior, proximo in zip(blocos,blocos[1:]):
        inicio, fim = anterior["fim"],proximo["inicio"]
        if fim-inicio >= args.pausa_min:
            pausas.append({"inicio":inicio,"fim":fim,
                           "duracao":round(fim-inicio,3),
                           "tipo":"CANDIDATA_A_REVISAO"})
    dados = {"versao":"0.3","arquivo":str(origem.resolve()),
             "modelo":args.modelo,"idioma":args.idioma,
             "observacoes":["Não identifica falantes/câmeras.",
                            "Pausas estimadas entre blocos transcritos; não são cortes aprovados.",
                            "Tempos relativos ao início do arquivo, não à posição na timeline."],
             "blocos":blocos,"pausas_candidatas":pausas}
    out = Path(args.saida)
    out.parent.mkdir(parents=True,exist_ok=True)
    out.with_suffix(".json").write_text(json.dumps(dados,ensure_ascii=False,indent=2),encoding="utf-8")
    with out.with_suffix(".csv").open("w",encoding="utf-8-sig",newline="") as f:
        writer=csv.writer(f,delimiter=";")
        writer.writerow(["inicio_s","fim_s","texto"])
        for b in blocos:writer.writerow([b["inicio"],b["fim"],b["texto"]])
    with out.parent.joinpath(out.name+"_pausas.csv").open("w",encoding="utf-8-sig",newline="") as f:
        writer=csv.writer(f,delimiter=";")
        writer.writerow(["inicio_s","fim_s","duracao_s","tipo"])
        for pausa in pausas:writer.writerow([pausa["inicio"],pausa["fim"],pausa["duracao"],pausa["tipo"]])
    print(f"\nCONCLUÍDO: {len(blocos)} blocos, {len(pausas)} pausas candidatas.")
    print("Arquivos:",out.with_suffix(".json"),out.with_suffix(".csv"),
          out.parent.joinpath(out.name+"_pausas.csv"))
    print("Nenhuma alteração feita no Premiere.")
if __name__=="__main__":
    main()
