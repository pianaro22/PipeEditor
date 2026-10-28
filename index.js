const { entrypoints, storage } = require("uxp");

entrypoints.setup({
  panels: {
    pipeEditorPanel: {
      show() {
        console.log("Pipe Editor AI 0.3 aberto");
      }
    }
  }
});

const fs = storage.localFileSystem;

const readButton = document.getElementById("readButton");
const importButton = document.getElementById("importButton");

const status = document.getElementById("status");
const importStatus = document.getElementById("importStatus");

const summary = document.getElementById("summary");
const tracks = document.getElementById("tracks");

const cutCount = document.getElementById("cutCount");
const removedTime = document.getElementById("removedTime");
const finalDuration = document.getElementById("finalDuration");

const validationStatus = document.getElementById("validationStatus");
const cutsList = document.getElementById("cutsList");

let activeSequenceDuration = null;
let importedCuts = null;

const fmt = n =>
  Number.isFinite(n)
    ? n.toFixed(2) + " s"
    : "indisponível";

const safe = value =>
  String(value ?? "sem nome");

function line(parent, cls, value) {
  const el = document.createElement("div");

  el.className = cls;
  el.textContent = value;

  parent.appendChild(el);
}

function getTime(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : NaN;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  if (value && typeof value === "object") {
    if (value.seconds !== undefined) {
      return getTime(value.seconds);
    }

    if (value.time !== undefined) {
      return getTime(value.time);
    }
  }

  return NaN;
}

function normalizeCut(item) {
  if (Array.isArray(item) && item.length >= 2) {
    return {
      start: getTime(item[0]),
      end: getTime(item[1])
    };
  }

  if (!item || typeof item !== "object") {
    return {
      start: NaN,
      end: NaN
    };
  }

  return {
    start: getTime(
      item.start ??
      item.inicio ??
      item.start_time ??
      item.startTime ??
      item.in
    ),

    end: getTime(
      item.end ??
      item.fim ??
      item.end_time ??
      item.endTime ??
      item.out
    )
  };
}

function extractCuts(data) {

  const candidates = [];

  function inspect(value, path = "root", depth = 0) {

    if (depth > 5 || value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {

      if (value.length > 0) {

        const first = value[0];

        const isCutArray =
          Array.isArray(first) &&
          first.length >= 2 &&
          Number.isFinite(getTime(first[0])) &&
          Number.isFinite(getTime(first[1]));

        const isCutObject =
          first &&
          typeof first === "object" &&
          !Array.isArray(first) &&
          (
            first.start !== undefined ||
            first.inicio !== undefined ||
            first.start_time !== undefined ||
            first.startTime !== undefined
          ) &&
          (
            first.end !== undefined ||
            first.fim !== undefined ||
            first.end_time !== undefined ||
            first.endTime !== undefined
          );

        if (isCutArray || isCutObject) {
          candidates.push({
            path,
            items: value
          });
        }
      }

      return;
    }

    if (typeof value === "object") {

      for (const key of Object.keys(value)) {

        inspect(
          value[key],
          path + "." + key,
          depth + 1
        );
      }
    }
  }

  inspect(data);

  if (!candidates.length) {

    const keys =
      data && typeof data === "object"
        ? Object.keys(data).join(", ")
        : "nenhuma";

    throw new Error(
      "Não foi encontrada uma lista de intervalos.\n" +
      "Campos encontrados no JSON: " + keys
    );
  }

  const preferredNames = [
    "cuts",
    "cortes",
    "intervals",
    "intervalos",
    "smart_cuts",
    "smartCuts",
    "removals",
    "cut_intervals",
    "cutIntervals",
    "remover",
    "trechos_removidos"
  ];

  function score(candidate) {

    const lastKey =
      candidate.path.split(".").pop();

    const index =
      preferredNames.indexOf(lastKey);

    if (index !== -1) {
      return 100 - index;
    }

    if (/cut|corte|remov|interval/i.test(lastKey)) {
      return 50;
    }

    return 0;
  }

  candidates.sort((a, b) => score(b) - score(a));

  const selected = candidates[0];

  // Não interpretar automaticamente palavras ou
  // segmentos de transcrição como cortes.
  if (score(selected) === 0) {

    throw new Error(
      "Encontrei intervalos de tempo, mas não consegui " +
      "confirmar que são cortes.\n" +
      "Campo encontrado: " + selected.path + "\n" +
      "Envie o JSON para ajustar o importador."
    );
  }

  const cuts = selected.items.map(normalizeCut);

  for (let i = 0; i < cuts.length; i++) {

    const cut = cuts[i];

    if (
      !Number.isFinite(cut.start) ||
      !Number.isFinite(cut.end)
    ) {
      throw new Error(
        `Corte ${i + 1}: horário inválido.`
      );
    }

    if (
      cut.start < 0 ||
      cut.end <= cut.start
    ) {
      throw new Error(
        `Corte ${i + 1}: intervalo inválido.`
      );
    }
  }

  cuts.sort((a, b) => a.start - b.start);

  console.log(
    "Pipe Editor AI: cortes encontrados em",
    selected.path
  );

  return cuts;
}

function validateCuts(cuts) {
  const problems = [];

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];

    if (i > 0 && cut.start < cuts[i - 1].end) {
      problems.push(
        `Sobreposição entre os cortes ${i} e ${i + 1}.`
      );
    }

    if (
      activeSequenceDuration !== null &&
      cut.end > activeSequenceDuration + 0.001
    ) {
      problems.push(
        `Corte ${i + 1} ultrapassa a sequência.`
      );
    }
  }

  return problems;
}

function renderCuts() {
  if (!importedCuts) {
    return;
  }

  const cuts = importedCuts;

  const totalRemoved = cuts.reduce(
    (sum, cut) => sum + (cut.end - cut.start),
    0
  );

  cutCount.textContent = String(cuts.length);
  removedTime.textContent = fmt(totalRemoved);

  if (activeSequenceDuration !== null) {
    finalDuration.textContent = fmt(
      activeSequenceDuration - totalRemoved
    );
  } else {
    finalDuration.textContent = "Leia a sequência";
  }

  const problems = validateCuts(cuts);

  validationStatus.textContent = "";

  if (activeSequenceDuration === null) {
    validationStatus.textContent =
      "Leia a sequência ativa para validar os horários.";

    validationStatus.className = "warning";
  } else if (problems.length > 0) {
    validationStatus.textContent =
      "Validação encontrou problemas:\n" +
      problems.join("\n");

    validationStatus.className = "error";
  } else {
    validationStatus.textContent =
      "Intervalos válidos dentro da duração da sequência.\n" +
      "A correspondência com o áudio original ainda precisa ser confirmada.";

    validationStatus.className = "success";
  }

  cutsList.textContent = "";

  cuts.forEach((cut, index) => {
    const box = document.createElement("div");

    box.className = "cut";

    const title = document.createElement("strong");

    title.textContent =
      `CORTE ${String(index + 1).padStart(2, "0")}`;

    const detail = document.createElement("div");

    detail.textContent =
      `${fmt(cut.start)} → ${fmt(cut.end)}`;

    const duration = document.createElement("small");

    duration.textContent =
      `Remover ${fmt(cut.end - cut.start)}`;

    box.appendChild(title);
    box.appendChild(detail);
    box.appendChild(duration);

    cutsList.appendChild(box);
  });
}

async function scanTrack(app, seq, kind, index) {
  const tr = kind === "V"
    ? await seq.getVideoTrack(index)
    : await seq.getAudioTrack(index);

  const heading =
    `${kind}${index + 1} · ${safe(tr.name)}`;

  const box = document.createElement("div");

  box.className = "track";

  line(box, "", heading);

  const items = await tr.getTrackItems(
    app.Constants.TrackItemType.CLIP,
    false
  );

  if (!items.length) {
    line(box, "clip", "Nenhum clipe.");
  }

  for (const item of items) {
    const [name, start, end, duration] =
      await Promise.all([
        item.getName(),
        item.getStartTime(),
        item.getEndTime(),
        item.getDuration()
      ]);

    line(
      box,
      "clip",
      `${safe(name)} | início ${fmt(start.seconds)} | ` +
      `fim ${fmt(end.seconds)} | ` +
      `duração ${fmt(duration.seconds)}`
    );
  }

  tracks.appendChild(box);

  return items.length;
}

readButton.addEventListener("click", async () => {
  readButton.disabled = true;

  status.textContent = "Consultando o Premiere...";

  summary.textContent = "";
  tracks.textContent = "";

  activeSequenceDuration = null;

  try {
    const app = require("premierepro");

    const project = await app.Project.getActiveProject();

    if (!project) {
      throw new Error(
        "Nenhum projeto ativo. Abra um projeto no Premiere."
      );
    }

    const seq = await project.getActiveSequence();

    if (!seq) {
      throw new Error(
        "Nenhuma sequência ativa. Abra a timeline."
      );
    }

    const [vCount, aCount, end, size] =
      await Promise.all([
        seq.getVideoTrackCount(),
        seq.getAudioTrackCount(),
        seq.getEndTime(),
        seq.getFrameSize()
      ]);

    activeSequenceDuration = end.seconds;

    line(summary, "", `Projeto: ${safe(project.name)}`);
    line(summary, "", `Sequência: ${safe(seq.name)}`);
    line(summary, "", `Duração: ${fmt(end.seconds)}`);

    line(
      summary,
      "",
      `Quadro: ${safe(size.width)} × ${safe(size.height)}`
    );

    line(
      summary,
      "",
      `Faixas: ${vCount} de vídeo, ${aCount} de áudio`
    );

    let total = 0;

    for (let i = 0; i < vCount; i++) {
      total += await scanTrack(app, seq, "V", i);
    }

    for (let i = 0; i < aCount; i++) {
      total += await scanTrack(app, seq, "A", i);
    }

    status.textContent =
      `Leitura concluída: ${total} clipe(s).\n` +
      "Nenhum corte foi aplicado.";

    renderCuts();

  } catch (err) {
    status.textContent =
      "Erro ao ler: " +
      (err?.message || String(err));

    console.error(err);

  } finally {
    readButton.disabled = false;
  }
});

importButton.addEventListener("click", async () => {
  importButton.disabled = true;

  importStatus.textContent = "Selecionando relatório...";

  try {
    const file = await fs.getFileForOpening({
      types: ["json"],
      allowMultiple: false
    });

    if (!file) {
      importStatus.textContent =
        "Importação cancelada.";

      return;
    }

    const content = await file.read();

    let data;

    try {
      data = JSON.parse(content);
    } catch {
      throw new Error(
        "O arquivo selecionado não contém JSON válido."
      );
    }

    const cuts = extractCuts(data);

    importedCuts = cuts;

    importStatus.textContent =
      `Arquivo: ${file.name}\n` +
      `${cuts.length} intervalo(s) importado(s).`;

    renderCuts();

  } catch (err) {
    importStatus.textContent =
      "Erro na importação: " +
      (err?.message || String(err));

    console.error(err);

  } finally {
    importButton.disabled = false;
  }
});

  // ==========================================
// PIPE EDITOR AI 0.4
// DIAGNÓSTICO DE 3 CORTES
// ==========================================

const testCutsButton =
  document.getElementById("testCutsButton");

const testCutsStatus =
  document.getElementById("testCutsStatus");

const testCutsDetails =
  document.getElementById("testCutsDetails");

async function getOverlappingClips(
  track,
  app,
  start,
  end
) {
  const items = await track.getTrackItems(
    app.Constants.TrackItemType.CLIP,
    false
  );

  const overlapping = [];

  for (const item of items) {
    const [itemStart, itemEnd, name] =
      await Promise.all([
        item.getStartTime(),
        item.getEndTime(),
        item.getName()
      ]);

    const clipStart = itemStart.seconds;
    const clipEnd = itemEnd.seconds;

    if (
      clipStart < end &&
      clipEnd > start
    ) {
      overlapping.push({
        name,
        start: clipStart,
        end: clipEnd
      });
    }
  }

  return overlapping;
}

testCutsButton.addEventListener(
  "click",
  async () => {

    testCutsButton.disabled = true;

    testCutsStatus.textContent =
      "Analisando três intervalos...";

    testCutsDetails.textContent = "";

    try {
      if (!importedCuts || importedCuts.length === 0) {
        throw new Error(
          "Importe primeiro o JSON do Smart Cut."
        );
      }

      if (activeSequenceDuration === null) {
        throw new Error(
          "Leia primeiro a sequência ativa."
        );
      }

      const app = require("premierepro");

      const project =
        await app.Project.getActiveProject();

      if (!project) {
        throw new Error("Nenhum projeto ativo.");
      }

      const seq =
        await project.getActiveSequence();

      if (!seq) {
        throw new Error("Nenhuma sequência ativa.");
      }

      const [vCount, aCount, seqEnd] =
        await Promise.all([
          seq.getVideoTrackCount(),
          seq.getAudioTrackCount(),
          seq.getEndTime()
        ]);

      if (vCount < 2 || aCount < 1) {
        throw new Error(
          "A sequência precisa ter V1, V2 e A1."
        );
      }

      // Confirma se a duração não mudou
      // desde a última leitura.
      if (
        Math.abs(
          seqEnd.seconds - activeSequenceDuration
        ) > 0.05
      ) {
        throw new Error(
          "A duração da sequência mudou. " +
          "Clique novamente em Ler sequência ativa."
        );
      }

      const problems = validateCuts(importedCuts);

      if (problems.length > 0) {
        throw new Error(
          "Existem intervalos inválidos:\n" +
          problems.join("\n")
        );
      }

      const tracksToCheck = [
        {
          name: "V1",
          track: await seq.getVideoTrack(0)
        },
        {
          name: "V2",
          track: await seq.getVideoTrack(1)
        },
        {
          name: "A1",
          track: await seq.getAudioTrack(0)
        }
      ];

      const firstThree = importedCuts.slice(0, 3);

      let totalDuration = 0;
      let missingTracks = 0;

      for (
        let index = 0;
        index < firstThree.length;
        index++
      ) {
        const cut = firstThree[index];

        const duration = cut.end - cut.start;

        totalDuration += duration;

        const box = document.createElement("div");

        box.className = "cut";

        const title = document.createElement("strong");

        title.textContent =
          `TESTE ${index + 1}`;

        box.appendChild(title);

        line(
          box,
          "clip",
          `Início: ${fmt(cut.start)}`
        );

        line(
          box,
          "clip",
          `Fim: ${fmt(cut.end)}`
        );

        line(
          box,
          "clip",
          `Remoção: ${fmt(duration)}`
        );

        for (const target of tracksToCheck) {
          const clips = await getOverlappingClips(
            target.track,
            app,
            cut.start,
            cut.end
          );

          if (clips.length === 0) {
            missingTracks++;
          }

          line(
            box,
            "clip",
            `${target.name}: ${clips.length} clipe(s) ` +
            `no intervalo`
          );

          for (const clip of clips) {
            line(
              box,
              "clip",
              `  ${safe(clip.name)} | ` +
              `${fmt(clip.start)} → ${fmt(clip.end)}`
            );
          }
        }

        testCutsDetails.appendChild(box);
      }

      testCutsStatus.textContent =
        `Diagnóstico concluído.\n` +
        `Cortes analisados: ${firstThree.length}\n` +
        `Tempo previsto de remoção: ${fmt(totalDuration)}\n` +
        `Faixas sem clipes nos intervalos: ${missingTracks}\n\n` +
        `Nenhuma alteração foi realizada.`;

      testCutsStatus.className =
        missingTracks > 0 ? "warning" : "success";

    } catch (err) {
      testCutsStatus.textContent =
        "Erro no diagnóstico: " +
        (err?.message || String(err));

      testCutsStatus.className = "error";

      console.error(err);

    } finally {
      testCutsButton.disabled = false;
    }
  }
);

    // ==========================================
// PIPE EDITOR AI 0.5
// DUPLICAÇÃO SEGURA DA SEQUÊNCIA
// ==========================================

const cloneSequenceButton =
  document.getElementById("cloneSequenceButton");

const cloneSequenceStatus =
  document.getElementById("cloneSequenceStatus");

const cloneSequenceDetails =
  document.getElementById("cloneSequenceDetails");

let smartCutClone = null;

async function getSequenceSnapshot(seq, app) {
  const [end, videoCount, audioCount] =
    await Promise.all([
      seq.getEndTime(),
      seq.getVideoTrackCount(),
      seq.getAudioTrackCount()
    ]);

  const snapshot = {
    name: seq.name,
    guid: seq.guid,
    duration: end.seconds,
    videoCount,
    audioCount,
    tracks: []
  };

  for (const kind of ["V", "A"]) {
    const count =
      kind === "V" ? videoCount : audioCount;

    for (let index = 0; index < count; index++) {
      const track =
        kind === "V"
          ? await seq.getVideoTrack(index)
          : await seq.getAudioTrack(index);

      const items = await track.getTrackItems(
        app.Constants.TrackItemType.CLIP,
        false
      );

      const clips = [];

      for (const item of items) {
        const [name, start, endTime] =
          await Promise.all([
            item.getName(),
            item.getStartTime(),
            item.getEndTime()
          ]);

        clips.push({
          name: String(name),
          start: start.seconds,
          end: endTime.seconds
        });
      }

      clips.sort(
        (a, b) =>
          a.start - b.start ||
          a.end - b.end ||
          a.name.localeCompare(b.name)
      );

      snapshot.tracks.push({
        id: `${kind}${index + 1}`,
        clips
      });
    }
  }

  return snapshot;
}

function compareSequenceSnapshots(original, clone) {
  const problems = [];

  const tolerance = 0.001;

  if (
    Math.abs(original.duration - clone.duration) >
    tolerance
  ) {
    problems.push("A duração das sequências é diferente.");
  }

  if (
    original.videoCount !== clone.videoCount ||
    original.audioCount !== clone.audioCount
  ) {
    problems.push("A quantidade de faixas é diferente.");
  }

  if (original.tracks.length !== clone.tracks.length) {
    problems.push("A estrutura das faixas é diferente.");
  }

  for (const originalTrack of original.tracks) {
    const clonedTrack = clone.tracks.find(
      track => track.id === originalTrack.id
    );

    if (!clonedTrack) {
      problems.push(
        `Faixa ${originalTrack.id} não encontrada na cópia.`
      );

      continue;
    }

    if (
      originalTrack.clips.length !==
      clonedTrack.clips.length
    ) {
      problems.push(
        `Quantidade de clipes diferente em ${originalTrack.id}.`
      );

      continue;
    }

    for (
      let index = 0;
      index < originalTrack.clips.length;
      index++
    ) {
      const a = originalTrack.clips[index];
      const b = clonedTrack.clips[index];

      if (
        a.name !== b.name ||
        Math.abs(a.start - b.start) > tolerance ||
        Math.abs(a.end - b.end) > tolerance
      ) {
        problems.push(
          `Diferença no clipe ${index + 1} de ${originalTrack.id}.`
        );
      }
    }
  }

  return problems;
}

cloneSequenceButton.addEventListener(
  "click",
  async () => {
    cloneSequenceButton.disabled = true;

    cloneSequenceStatus.className = "";
    cloneSequenceStatus.textContent =
      "Preparando duplicação...";

    cloneSequenceDetails.textContent = "";

    try {
      const app = require("premierepro");

      const project =
        await app.Project.getActiveProject();

      if (!project) {
        throw new Error("Nenhum projeto ativo.");
      }

      const original =
        await project.getActiveSequence();

      if (!original) {
        throw new Error("Nenhuma sequência ativa.");
      }

      // Não duplicar novamente a mesma sequência
      // por engano durante um teste.
      if (
        smartCutClone &&
        smartCutClone.sourceGuid === original.guid
      ) {
        throw new Error(
          "Esta sequência já foi duplicada nesta sessão. " +
          "Confira a cópia criada antes de repetir o teste."
        );
      }

      const originalSnapshot =
        await getSequenceSnapshot(original, app);

      const sequencesBefore =
        await project.getSequences();

      const previousGuids = new Set(
        sequencesBefore.map(seq => String(seq.guid))
      );

      cloneSequenceStatus.textContent =
        "Duplicando sequência no projeto...";

      // As ações devem ser criadas e executadas
      // dentro do acesso bloqueado ao projeto.
      //
      // A chamada é síncrona conforme a API UXP.
      let transactionResult;

      project.lockedAccess(() => {
        const cloneAction =
          original.createCloneAction();

        transactionResult =
          project.executeTransaction(
            compoundAction => {
              compoundAction.addAction(cloneAction);
            },
            "Pipe Editor AI - Duplicar sequência"
          );
      });

      if (transactionResult !== true) {
        throw new Error(
          "O Premiere não confirmou a transação de duplicação."
        );
      }

      const sequencesAfter =
        await project.getSequences();

      const createdSequences =
        sequencesAfter.filter(
          seq => !previousGuids.has(String(seq.guid))
        );

      if (createdSequences.length !== 1) {
        throw new Error(
          "A transação foi executada, mas não foi possível " +
          "identificar uma única sequência nova. " +
          "Verifique o painel Projeto antes de tentar novamente."
        );
      }

      const clonedSequence = createdSequences[0];

      const cloneSnapshot =
        await getSequenceSnapshot(clonedSequence, app);

      const differences =
        compareSequenceSnapshots(
          originalSnapshot,
          cloneSnapshot
        );

      smartCutClone = {
        sourceGuid: original.guid,
        cloneGuid: clonedSequence.guid
      };

      line(
        cloneSequenceDetails,
        "clip",
        `Original: ${originalSnapshot.name}`
      );

      line(
        cloneSequenceDetails,
        "clip",
        `Cópia: ${cloneSnapshot.name}`
      );

      line(
        cloneSequenceDetails,
        "clip",
        `Duração original: ${fmt(originalSnapshot.duration)}`
      );

      line(
        cloneSequenceDetails,
        "clip",
        `Duração da cópia: ${fmt(cloneSnapshot.duration)}`
      );

      line(
        cloneSequenceDetails,
        "clip",
        `Faixas de vídeo: ${cloneSnapshot.videoCount}`
      );

      line(
        cloneSequenceDetails,
        "clip",
        `Faixas de áudio: ${cloneSnapshot.audioCount}`
      );

      for (const track of cloneSnapshot.tracks) {
        line(
          cloneSequenceDetails,
          "clip",
          `${track.id}: ${track.clips.length} clipe(s)`
        );
      }

      if (differences.length > 0) {
        cloneSequenceStatus.className = "warning";

        cloneSequenceStatus.textContent =
          "Cópia criada, mas foram encontradas diferenças:\n" +
          differences.slice(0, 10).join("\n") +
          "\nNenhum corte foi aplicado.";
      } else {
        cloneSequenceStatus.className = "success";

        cloneSequenceStatus.textContent =
          "Sequência duplicada com sucesso.\n" +
          "Duração, quantidade de faixas, nomes e " +
          "posições dos clipes conferidos.\n" +
          "Nenhum corte foi aplicado.";
      }

    } catch (err) {
      cloneSequenceStatus.className = "error";

      cloneSequenceStatus.textContent =
        "Erro na duplicação: " +
        (err?.message || String(err));

      console.error(err);

    } finally {
      cloneSequenceButton.disabled = false;
    }
  }
);

// PIPE EDITOR AI 0.6 - DIAGNÓSTICO DA API
const checkEditingApiButton =
  document.getElementById("checkEditingApiButton");

const editingApiStatus =
  document.getElementById("editingApiStatus");

checkEditingApiButton.addEventListener(
  "click",
  async () => {
    checkEditingApiButton.disabled = true;

    editingApiStatus.textContent =
      "Verificando recursos de edição...";

    try {
      const app = require("premierepro");

      const project =
        await app.Project.getActiveProject();

      if (!project) {
        throw new Error("Nenhum projeto ativo.");
      }

      const sequence =
        await project.getActiveSequence();

      if (!sequence) {
        throw new Error("Nenhuma sequência ativa.");
      }

      const editor =
        app.SequenceEditor.getEditor(sequence);

      const videoTrack =
        await sequence.getVideoTrack(0);

      const audioTrack =
        await sequence.getAudioTrack(0);

      const videoItems =
        await videoTrack.getTrackItems(
          app.Constants.TrackItemType.CLIP,
          false
        );

      const audioItems =
        await audioTrack.getTrackItems(
          app.Constants.TrackItemType.CLIP,
          false
        );

      const videoClip = videoItems[0];
      const audioClip = audioItems[0];

      function available(object, method) {
        return Boolean(
          object &&
          typeof object[method] === "function"
        );
      }

      const results = [
        ["SequenceEditor", Boolean(editor)],

        [
          "Remover itens",
          available(editor, "createRemoveItemsAction")
        ],

        [
          "Inserir mídia",
          available(editor, "createInsertProjectItemAction")
        ],

        [
          "Sobrescrever mídia",
          available(editor, "createOverwriteItemAction")
        ],

        [
          "Duplicar item",
          available(editor, "createCloneTrackItemAction")
        ],

        [
          "Ajustar início do vídeo",
          available(videoClip, "createSetStartAction")
        ],

        [
          "Ajustar fim do vídeo",
          available(videoClip, "createSetEndAction")
        ],

        [
          "Ajustar início do áudio",
          available(audioClip, "createSetStartAction")
        ],

        [
          "Ajustar fim do áudio",
          available(audioClip, "createSetEndAction")
        ],

        [
          "Mover vídeo",
          available(videoClip, "createMoveAction")
        ],

        [
          "Duplicar sequência",
          available(sequence, "createCloneAction")
        ]
      ];

      editingApiStatus.textContent =
        results.map(([name, supported]) =>
          `${supported ? "OK" : "INDISPONÍVEL"} · ${name}`
        ).join("\n");

      console.log(
        "Pipe Editor AI - Recursos de edição:",
        results
      );

    } catch (err) {
      editingApiStatus.textContent =
        "Erro: " + (err?.message || String(err));

      console.error(err);

    } finally {
      checkEditingApiButton.disabled = false;
    }
  }
);
